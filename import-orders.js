// Evolution Shipping Tracker — One-time import script
// Run this from your terminal: node import-orders.js

const BASE_URL = 'https://evolution-shipping.vercel.app';

const orders = [
  {
    vendor: "Lutron",
    description: "Lutron order - shades/lighting controls",
    order_number: "29177732 / PO: GREENBERG4712",
    order_date: "2026-02-15",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: "Greenberg",
    notes: "Imported from email. Tracking details in Lutron PDF attachment.",
    created_by: "System Import"
  },
  {
    vendor: "Lutron",
    description: "Lutron order shipped",
    order_number: "29248491 / PO: KRAFT4747",
    order_date: "2026-02-16",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: "Kraft",
    notes: "Imported from email. Tracking details in Lutron PDF attachment.",
    created_by: "System Import"
  },
  {
    vendor: "Lutron",
    description: "Lutron order shipped",
    order_number: "29539672 / PO: 4833",
    order_date: "2026-02-16",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email. Tracking details in Lutron PDF attachment.",
    created_by: "System Import"
  },
  {
    vendor: "Lutron",
    description: "Lutron shades shipment",
    order_number: "29550721 / PO: 4850",
    order_date: "2026-02-16",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: "Eskenazi",
    notes: "Imported from email. Eskenazi Shades. Tracking details in Lutron PDF.",
    created_by: "System Import"
  },
  {
    vendor: "Lutron",
    description: "Lutron order shipped",
    order_number: "29451460 / PO: FRANK4806",
    order_date: "2026-02-17",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: "Frank",
    notes: "Imported from email. Tracking details in Lutron PDF attachment.",
    created_by: "System Import"
  },
  {
    vendor: "Design & Grace",
    description: "Package from Design & Grace via UPS",
    order_number: null,
    order_date: "2026-02-17",
    tracking_number: "1ZY727B30218922563",
    carrier: "UPS",
    status: "Delivered",
    estimated_delivery: "2026-02-18",
    project: null,
    notes: "Imported from email. UPS 2nd Day Air. Ship to: 213 W Main, Belgrade MT 59714.",
    created_by: "System Import"
  },
  {
    vendor: "Crestron",
    description: "HZ2 keypads and accessories - partial shipment",
    order_number: "3577250 / PO: 4799",
    order_date: "2026-02-18",
    tracking_number: "1Z4R16040341683546",
    carrier: "UPS",
    status: "Shipped",
    estimated_delivery: null,
    project: "Richter Residence",
    notes: "Imported from email. UPS Ground. Partial shipment.",
    created_by: "System Import"
  },
  {
    vendor: "Legrand",
    description: "Middle Atlantic racks and accessories",
    order_number: "4149241 / PO: LARAE",
    order_date: "2026-02-18",
    tracking_number: null,
    carrier: "R+L Carriers",
    status: "Shipped",
    estimated_delivery: null,
    project: "Larae",
    notes: "Imported from email. LTL freight via R&L Carriers. Order confirmed 2/18, shipped 2/24.",
    created_by: "System Import"
  },
  {
    vendor: "Crestron",
    description: "CEN-IO-IR-104 IR interface - partial shipment",
    order_number: "3588905 / PO: PO #3",
    order_date: "2026-02-19",
    tracking_number: "1Z4R16040340141810",
    carrier: "UPS",
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email. UPS Ground. Partial shipment.",
    created_by: "System Import"
  },
  {
    vendor: "Lutron",
    description: "Lutron shades order",
    order_number: "29570429 / PO: BROGLIO001",
    order_date: "2026-02-19",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: "Broglio",
    notes: "Imported from email. Tracking details in Lutron PDF attachment.",
    created_by: "System Import"
  },
  {
    vendor: "FedEx",
    description: "FedEx shipment scheduled",
    order_number: null,
    order_date: "2026-02-20",
    tracking_number: "513745507897",
    carrier: "FedEx",
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email. Shipper not identified in subject.",
    created_by: "System Import"
  },
  {
    vendor: "Sonance",
    description: "Sonance shipping confirmation",
    order_number: "3030137103",
    order_date: "2026-02-21",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email.",
    created_by: "System Import"
  },
  {
    vendor: "Sonance",
    description: "Sonance shipping confirmation",
    order_number: "3030135018",
    order_date: "2026-02-21",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email.",
    created_by: "System Import"
  },
  {
    vendor: "Sonance",
    description: "Sonance shipping confirmation",
    order_number: "3030138525",
    order_date: "2026-02-21",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email.",
    created_by: "System Import"
  },
  {
    vendor: "Sonance",
    description: "Sonance shipping confirmation",
    order_number: "3030136814",
    order_date: "2026-02-21",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email.",
    created_by: "System Import"
  },
  {
    vendor: "Sonance",
    description: "Sonance shipping confirmation",
    order_number: "3030137419",
    order_date: "2026-02-21",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email.",
    created_by: "System Import"
  },
  {
    vendor: "Sonance",
    description: "Sonance shipping confirmation",
    order_number: "3030138316",
    order_date: "2026-02-21",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email.",
    created_by: "System Import"
  },
  {
    vendor: "Lutron",
    description: "Lutron order shipped",
    order_number: "29561754 / PO: 4854",
    order_date: "2026-02-21",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email. Tracking details in Lutron PDF attachment.",
    created_by: "System Import"
  },
  {
    vendor: "FedEx",
    description: "FedEx shipment scheduled",
    order_number: null,
    order_date: "2026-02-23",
    tracking_number: "513745517762",
    carrier: "FedEx",
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email. Shipper not identified in subject.",
    created_by: "System Import"
  },
  {
    vendor: "FedEx",
    description: "FedEx shipment scheduled",
    order_number: null,
    order_date: "2026-02-25",
    tracking_number: "513745533493",
    carrier: "FedEx",
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email. Shipper not identified in subject.",
    created_by: "System Import"
  },
  {
    vendor: "Lutron",
    description: "Lutron lights shipment",
    order_number: "29559469 / PO: 4852",
    order_date: "2026-02-25",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: "Ahi Lights",
    notes: "Imported from email. Tracking details in Lutron PDF attachment.",
    created_by: "System Import"
  },
  {
    vendor: "Crestron",
    description: "Crestron order shipped complete",
    order_number: "PO: 4830",
    order_date: "2026-02-26",
    tracking_number: null,
    carrier: null,
    status: "Shipped",
    estimated_delivery: null,
    project: null,
    notes: "Imported from email. Complete shipment.",
    created_by: "System Import"
  }
];

async function importOrders() {
  let success = 0;
  let fail = 0;

  for (const order of orders) {
    try {
      const res = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      });
      if (res.ok) {
        success++;
        console.log(`OK: ${order.vendor} - ${order.order_number || order.tracking_number || order.description}`);
      } else {
        const err = await res.text();
        fail++;
        console.log(`FAIL: ${order.vendor} - ${err}`);
      }
    } catch (e) {
      fail++;
      console.log(`ERROR: ${order.vendor} - ${e.message}`);
    }
  }

  console.log(`\n--- Import Complete ---`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${fail}`);
  console.log(`Total: ${orders.length}`);
}

importOrders();
