const BASE_URL = 'https://evolution-shipping.vercel.app';
const orders = [
  {
    vendor: 'Wesco',
    description: 'Multiple security components (cameras, doorbell, power supplies, relays, heat detectors, horn, communicator)',
    order_number: '52TB3VRB / PO: 4827',
    order_date: '2026-02-25',
    tracking_number: '1Z9407910390436687',
    carrier: 'UPS',
    status: 'Shipped',
    estimated_delivery: '2026-02-27',
    project: 'Frank',
    notes: 'Imported from email. Wesco Shipment Notification - PO #4827 has shipped from Wesco',
    created_by: 'System Import'
  },
  {
    vendor: 'TD SYNNEX',
    description: 'Sony BRAVIA Theater Bar 8 HT-A8000, Sony Bravia 7 K-85XR70 85" LED TV',
    order_number: '170804133 / PO: 4845',
    order_date: '2026-02-25',
    tracking_number: '8663945916',
    carrier: 'FedEx LTL Priority',
    status: 'Shipped',
    estimated_delivery: null,
    project: null,
    notes: 'Imported from email. Order#170804133 has been shipped by TD SYNNEX Corp.',
    created_by: 'System Import'
  },
  {
    vendor: 'TD SYNNEX',
    description: 'Sony VPL-XW6100ES SXRD projector with advanced crisp-focused lens',
    order_number: '170804128 / PO: 4845',
    order_date: '2026-02-25',
    tracking_number: '6396337990',
    carrier: 'FedEx LTL Priority',
    status: 'Shipped',
    estimated_delivery: null,
    project: null,
    notes: 'Imported from email. Order#170804128 has been shipped by TD SYNNEX Corp.',
    created_by: 'System Import'
  },
  {
    vendor: 'Wesco',
    description: 'Arlington brush style cable devices (30 units CED135)',
    order_number: '52TB3W5X / PO: STOCK 001',
    order_date: '2026-02-25',
    tracking_number: '1Z9WX9300334467034',
    carrier: 'UPS',
    status: 'Shipped',
    estimated_delivery: null,
    project: null,
    notes: 'Imported from email. PO #STOCK 001 has shipped from Wesco',
    created_by: 'System Import'
  },
  {
    vendor: 'Crestron',
    description: 'CS-SHADE-ROLLER motorized shades (12 units)',
    order_number: '3588610 / PO: 4830',
    order_date: '2026-02-26',
    tracking_number: null,
    carrier: 'ABF Freight',
    status: 'Shipped Complete',
    estimated_delivery: null,
    project: 'BRIAN FRANK RES.',
    notes: 'Imported from email. YOUR CRESTRON ORDER (PO# 4830 ) HAS SHIPPED COMPLETE.',
    created_by: 'System Import'
  }
];

async function importOrders() {
  let success = 0, fail = 0;
  for (const order of orders) {
    try {
      const res = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order)
      });
      if (res.ok) {
        success++;
        console.log(`OK: ${order.vendor} - ${order.order_number || order.tracking_number || order.description}`);
      } else {
        fail++;
        console.log(`FAIL: ${order.vendor} - ${await res.text()}`);
      }
    } catch (e) {
      fail++;
      console.log(`ERROR: ${order.vendor} - ${e.message}`);
    }
  }
  console.log(`\n--- Import Complete ---\nSuccess: ${success}\nFailed: ${fail}\nTotal: ${orders.length}`);
}

importOrders();
