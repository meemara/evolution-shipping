/**
 * Carrier tracking lookups.
 *
 * Replaces the scraped consumer endpoints (www.ups.com/track/api/Track/GetStatus and
 * www.fedex.com/trackingCal/track) that broke in September 2026 when both started
 * returning bot-challenge HTML instead of JSON. See the shipping-tracker handoff in
 * Knowledge Base/evolution-automations.md (2026-09-18).
 *
 * Provider: EasyPost Trackers API (https://docs.easypost.com/docs/trackers).
 *  - Billed per tracker REGISTERED, not per status read. So we look a tracking code up
 *    first and only create a tracker when EasyPost has never seen it. Daily re-checks
 *    of an existing tracker cost nothing.
 *  - Carrier is auto-detected from the tracking code, so callers do not have to
 *    pattern-match "1Z..." vs digits. A hint is passed when we have a trustworthy one.
 *
 * SAFETY CONTRACT (do not weaken -- 2026-09-18):
 * Every result carries an explicit `verified` flag. `verified` is true ONLY when a
 * carrier actually reported a usable state for that package. Anything else -- network
 * error, auth error, missing API key, unknown/undetectable carrier, EasyPost holding no
 * data -- is verified:false. The delivery-check route must never let a verified:false
 * order age out; that is what stops a carrier outage from emptying the tracker.
 */

export interface TrackingResult {
  tracking_number: string;
  delivered: boolean;
  status: string;
  delivery_date?: string;
  /** True only if a carrier returned a real, usable state for this package. */
  verified: boolean;
  /** Carrier as resolved by EasyPost, when it could resolve one. */
  detected_carrier?: string;
}

export interface TrackingQuery {
  tracking_number: string;
  /** Whatever the vendor scraper recorded, e.g. "UPS Ground", "FedEx", "Freight". */
  carrier_hint?: string | null;
}

const EASYPOST_BASE = 'https://api.easypost.com/v2';

/**
 * Account-level failures (bad key, unpaid balance) apply to every lookup in the run, not
 * just the one that hit them. Firing the remaining ~190 calls anyway earns a rate-limit
 * on top of the original error and buries it -- which is exactly what happened on the
 * first live run, 2026-09-18. Once one of these is seen, the rest of the run short-
 * circuits with the same message and makes no further calls.
 */
const ACCOUNT_LEVEL_STATUSES = new Set([401, 402, 403]);

/** EasyPost states that represent a real answer about where the package is. */
const USABLE_STATUSES = new Set([
  'pre_transit',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'available_for_pickup',
  'return_to_sender',
  'failure',
  'cancelled',
]);

/**
 * Map the scraper's free-text carrier column onto an EasyPost carrier name.
 * Returns undefined when we are not confident -- EasyPost auto-detects in that case,
 * which is better than asserting a wrong carrier.
 */
export function carrierHintToEasyPost(hint?: string | null): string | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (h.includes('ups')) return 'UPS';
  if (h.includes('fedex') || h.includes('fed ex')) return 'FedEx';
  if (h.includes('usps') || h.includes('postal')) return 'USPS';
  if (h.includes('dhl')) return 'DHL';
  return undefined;
}

function authHeader(apiKey: string): string {
  return 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
}

function failure(tracking_number: string, reason: string): TrackingResult {
  // The "API error:" prefix is kept for log continuity with the previous implementation.
  return {
    tracking_number,
    delivered: false,
    status: `API error: ${reason}`,
    verified: false,
  };
}

interface EasyPostTracker {
  tracking_code?: string;
  status?: string;
  carrier?: string;
  tracking_details?: Array<{ status?: string; datetime?: string }>;
}

function toResult(trackingNumber: string, tracker: EasyPostTracker): TrackingResult {
  const status = String(tracker.status || 'unknown');

  if (!USABLE_STATUSES.has(status)) {
    // "unknown" / "error" mean EasyPost has no usable carrier data for this code.
    // That is NOT a verified lookup -- treating it as one would let an order with no
    // delivery information age out, which is exactly the failure mode we fixed.
    return {
      tracking_number: trackingNumber,
      delivered: false,
      status: `API error: no carrier data (${status})`,
      verified: false,
      detected_carrier: tracker.carrier || undefined,
    };
  }

  const delivered = status === 'delivered';
  let deliveryDate: string | undefined;
  if (delivered && Array.isArray(tracker.tracking_details)) {
    const event = [...tracker.tracking_details]
      .reverse()
      .find(d => String(d.status || '').toLowerCase() === 'delivered');
    deliveryDate = event?.datetime || undefined;
  }

  return {
    tracking_number: trackingNumber,
    delivered,
    status,
    delivery_date: deliveryDate,
    verified: true,
    detected_carrier: tracker.carrier || undefined,
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * One request, retried on 429 only. EasyPost rate-limits per account, so a burst of
 * lookups can trip it even when everything else is healthy.
 */
async function easyPostFetch(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<Response> {
  const backoffMs = [1000, 3000];
  let resp = await fetch(`${EASYPOST_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(apiKey),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  for (const wait of backoffMs) {
    if (resp.status !== 429) break;
    await sleep(wait);
    resp = await fetch(`${EASYPOST_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(apiKey),
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  }

  return resp;
}

/** Pull a human-readable message out of an EasyPost error response, if there is one. */
async function errorDetail(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    return body?.error?.message ? ` - ${body.error.message}` : '';
  } catch {
    return '';
  }
}

/** Raised internally when the whole run should stop calling EasyPost. */
interface AccountFailure {
  reason: string;
}

/** Look up one tracking code: reuse an existing tracker if there is one, else create it. */
async function lookupOne(
  query: TrackingQuery,
  apiKey: string,
  abort: { failure: AccountFailure | null },
): Promise<TrackingResult> {
  const code = query.tracking_number;

  if (abort.failure) return failure(code, abort.failure.reason);

  try {
    // 1. Already registered? Reading an existing tracker is free.
    const listResp = await easyPostFetch(
      `/trackers?tracking_codes[]=${encodeURIComponent(code)}&page_size=5`,
      apiKey,
    );

    if (listResp.ok) {
      const listData = await listResp.json();
      const trackers: EasyPostTracker[] = Array.isArray(listData?.trackers)
        ? listData.trackers
        : [];
      // Only trust a row whose tracking_code actually matches what we asked for. If the
      // filter were ever ignored, the list endpoint would hand back the account's most
      // recent trackers and we would attribute another package's status to this order.
      const existing = trackers.find(
        t => String(t.tracking_code || '').toLowerCase() === code.toLowerCase(),
      );
      if (existing) return toResult(code, existing);
    } else if (ACCOUNT_LEVEL_STATUSES.has(listResp.status)) {
      const reason = `EasyPost rejected the account (${listResp.status})${await errorDetail(listResp)}`;
      abort.failure = { reason };
      return failure(code, reason);
    }

    // 2. Not registered yet -- create it. This is the billed call (~$0.02-0.03).
    const hint = carrierHintToEasyPost(query.carrier_hint);
    const createResp = await easyPostFetch('/trackers', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        tracker: { tracking_code: code, ...(hint ? { carrier: hint } : {}) },
      }),
    });

    if (!createResp.ok) {
      const detail = await errorDetail(createResp);
      const reason = `EasyPost create returned ${createResp.status}${detail}`;
      if (ACCOUNT_LEVEL_STATUSES.has(createResp.status)) {
        // Unpaid balance or bad key: every remaining lookup would fail the same way.
        abort.failure = { reason };
      }
      return failure(code, reason);
    }

    const tracker: EasyPostTracker = await createResp.json();
    return toResult(code, tracker);
  } catch (err) {
    return failure(code, String(err));
  }
}

/**
 * Look up many tracking codes. Never throws: a code that cannot be resolved comes back
 * as verified:false so the caller leaves that order alone.
 */
export async function lookupTracking(
  queries: TrackingQuery[],
  opts: { concurrency?: number } = {},
): Promise<TrackingResult[]> {
  const apiKey = process.env.EASYPOST_API_KEY;
  if (!apiKey) {
    return queries.map(q => failure(q.tracking_number, 'EASYPOST_API_KEY not configured'));
  }

  // Deliberately modest: EasyPost rate-limits per account, and a burst of ~200 lookups
  // at higher concurrency tripped a 429 on the first live run (2026-09-18).
  const concurrency = opts.concurrency ?? 4;
  const results: TrackingResult[] = new Array(queries.length);
  const abort: { failure: AccountFailure | null } = { failure: null };
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= queries.length) return;
      results[index] = await lookupOne(queries[index], apiKey!, abort);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queries.length) }, () => worker()),
  );

  return results;
}
