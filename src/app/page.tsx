'use client';

import { useState, useEffect, useCallback } from 'react';

// Types
interface Employee {
  id: number;
  name: string;
  role: 'admin' | 'viewer';
}

interface Order {
  id: number;
  vendor: string;
  description: string;
  order_number: string | null;
  order_date: string | null;
  tracking_number: string | null;
  carrier: string | null;
  status: string;
  estimated_delivery: string | null;
  actual_delivery: string | null;
  project: string | null;
  sender_email: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ChangeLogEntry {
  id: number;
  order_id: number;
  changed_by: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  vendor?: string;
  description?: string;
}

const ORDER_STATUSES = [
  'Order Placed',
  'Order Confirmed',
  'Processing',
  'Shipped',
  'In Transit',
  'Out for Delivery',
  'Delivered',
  'Delayed',
  'Cancelled',
];

const CARRIERS = ['UPS', 'FedEx', 'USPS', 'DHL', 'Freight', 'Other'];

function statusClass(status: string) {
  return 'status-' + status.toLowerCase().replace(/ /g, '-');
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ─── Name Selector (shown first visit) ─────────────────────
function NameSelector({
  employees,
  onSelect,
}: {
  employees: Employee[];
  onSelect: (emp: Employee) => void;
}) {
  const [selected, setSelected] = useState('');

  function handleContinue() {
    const emp = employees.find((e) => String(e.id) === selected);
    if (emp) onSelect(emp);
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'var(--evo-navy)' }}>
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-sm mx-4">
        <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--evo-navy)' }}>
          Evolution Shipping Tracker
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--evo-gray-500)' }}>
          Select your name to continue
        </p>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full px-4 py-3 border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 mb-4"
          style={{ borderColor: 'var(--evo-gray-300)', color: selected ? 'var(--evo-gray-900)' : 'var(--evo-gray-400)' }}
        >
          <option value="" disabled>Choose your name...</option>
          {employees.map((emp) => (
            <option key={emp.id} value={String(emp.id)}>
              {emp.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleContinue}
          disabled={!selected}
          className="w-full px-4 py-3 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-40"
          style={{ background: 'var(--evo-blue)' }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ─── Add/Edit Order Modal ───────────────────────────────────
function OrderModal({
  order,
  currentUser,
  onSave,
  onClose,
  isAdmin,
}: {
  order: Order | null; // null = new order
  currentUser: string;
  onSave: (data: Partial<Order>) => void;
  onClose: () => void;
  isAdmin: boolean;
}) {
  const isNew = !order;
  const [form, setForm] = useState({
    vendor: order?.vendor || '',
    description: order?.description || '',
    order_number: order?.order_number || '',
    order_date: order?.order_date?.split('T')[0] || '',
    tracking_number: order?.tracking_number || '',
    carrier: order?.carrier || '',
    status: order?.status || 'Order Placed',
    estimated_delivery: order?.estimated_delivery?.split('T')[0] || '',
    actual_delivery: order?.actual_delivery?.split('T')[0] || '',
    project: order?.project || '',
    notes: order?.notes || '',
  });

  const canEditAll = isAdmin;

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b" style={{ borderColor: 'var(--evo-gray-200)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: 'var(--evo-navy)' }}>
              {isNew ? 'Add New Order' : 'Edit Order'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
              &times;
            </button>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--evo-gray-500)' }}>
            {isNew ? `Creating as ${currentUser}` : `Editing as ${currentUser}`}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Vendor & Description - required, admin only for new */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
                Vendor *
              </label>
              <input
                type="text"
                value={form.vendor}
                onChange={(e) => handleChange('vendor', e.target.value)}
                required
                disabled={!isNew && !canEditAll}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
                style={{ borderColor: 'var(--evo-gray-300)' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
                Project
              </label>
              <input
                type="text"
                value={form.project}
                onChange={(e) => handleChange('project', e.target.value)}
                disabled={!isNew && !canEditAll}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
                style={{ borderColor: 'var(--evo-gray-300)' }}
                placeholder="e.g. Smith Residence"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
              Description *
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              required
              disabled={!isNew && !canEditAll}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
              style={{ borderColor: 'var(--evo-gray-300)' }}
              placeholder="e.g. Lutron RA3 Processors (x4)"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
                Order Number
              </label>
              <input
                type="text"
                value={form.order_number}
                onChange={(e) => handleChange('order_number', e.target.value)}
                disabled={!isNew && !canEditAll}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
                style={{ borderColor: 'var(--evo-gray-300)' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
                Order Date
              </label>
              <input
                type="date"
                value={form.order_date}
                onChange={(e) => handleChange('order_date', e.target.value)}
                disabled={!isNew && !canEditAll}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
                style={{ borderColor: 'var(--evo-gray-300)' }}
              />
            </div>
          </div>

          {/* Shipping fields - everyone can update these */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--evo-gray-200)' }}>
            <p className="text-xs font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--evo-gray-400)' }}>
              Shipping Info
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
                Status
              </label>
              <select
                value={form.status}
                onChange={(e) => handleChange('status', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ borderColor: 'var(--evo-gray-300)' }}
              >
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
                Carrier
              </label>
              <select
                value={form.carrier}
                onChange={(e) => handleChange('carrier', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ borderColor: 'var(--evo-gray-300)' }}
              >
                <option value="">Select...</option>
                {CARRIERS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
                Tracking Number
              </label>
              <input
                type="text"
                value={form.tracking_number}
                onChange={(e) => handleChange('tracking_number', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ borderColor: 'var(--evo-gray-300)' }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
                Est. Delivery
              </label>
              <input
                type="date"
                value={form.estimated_delivery}
                onChange={(e) => handleChange('estimated_delivery', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ borderColor: 'var(--evo-gray-300)' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
                Actual Delivery
              </label>
              <input
                type="date"
                value={form.actual_delivery}
                onChange={(e) => handleChange('actual_delivery', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ borderColor: 'var(--evo-gray-300)' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--evo-gray-700)' }}>
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              style={{ borderColor: 'var(--evo-gray-300)' }}
              placeholder="Any additional details..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="px-6 py-2 rounded-lg text-white text-sm font-medium transition-colors"
              style={{ background: 'var(--evo-blue)' }}
            >
              {isNew ? 'Add Order' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-gray-50"
              style={{ borderColor: 'var(--evo-gray-300)', color: 'var(--evo-gray-600)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Change Log Panel ───────────────────────────────────────
function ChangeLog({
  entries,
  onClose,
  title,
}: {
  entries: ChangeLogEntry[];
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="p-6 border-b flex items-center justify-between" style={{ borderColor: 'var(--evo-gray-200)' }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--evo-navy)' }}>{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
            &times;
          </button>
        </div>
        <div className="overflow-y-auto p-6">
          {entries.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--evo-gray-400)' }}>No changes recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--evo-gray-200)' }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium" style={{ color: 'var(--evo-gray-800)' }}>
                      {entry.changed_by}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--evo-gray-400)' }}>
                      {formatDateTime(entry.changed_at)}
                    </span>
                  </div>
                  <p style={{ color: 'var(--evo-gray-600)' }}>
                    Changed <strong>{entry.field_changed.replace(/_/g, ' ')}</strong>
                    {entry.vendor && (
                      <span className="text-xs ml-1" style={{ color: 'var(--evo-gray-400)' }}>
                        on {entry.vendor}
                      </span>
                    )}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--evo-gray-400)' }}>
                    {entry.old_value || '(empty)'} → {entry.new_value || '(empty)'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────
export default function Home() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [changeLogEntries, setChangeLogEntries] = useState<ChangeLogEntry[]>([]);
  const [changeLogTitle, setChangeLogTitle] = useState('Change Log');

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/orders');
      if (!res.ok) throw new Error('Failed to fetch orders');
      const data = await res.json();
      setOrders(data);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // Initial load
  useEffect(() => {
    async function init() {
      try {
        // Fetch employees
        const empRes = await fetch('/api/employees');
        if (!empRes.ok) throw new Error('Failed to load employees');
        const empData = await empRes.json();
        setEmployees(empData);

        // Fetch orders
        await fetchOrders();
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [fetchOrders]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  async function handleSaveOrder(data: Partial<Order>) {
    try {
      if (editingOrder) {
        // Update
        await fetch(`/api/orders/${editingOrder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, changed_by: currentUser!.name }),
        });
      } else {
        // Create
        await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, created_by: currentUser!.name }),
        });
      }
      setShowOrderModal(false);
      setEditingOrder(null);
      await fetchOrders();
    } catch (err) {
      alert('Failed to save order: ' + err);
    }
  }

  async function handleDeleteOrder(id: number) {
    if (!confirm('Delete this order? This cannot be undone.')) return;
    try {
      await fetch(`/api/orders/${id}?user_id=${currentUser!.id}`, { method: 'DELETE' });
      await fetchOrders();
    } catch (err) {
      alert('Failed to delete: ' + err);
    }
  }

  async function handleBlockSender(order: Order) {
    const senderEmail = order.sender_email;
    if (!senderEmail) {
      alert('No sender email on this order to block.');
      return;
    }
    if (!confirm(`Block all emails from "${senderEmail}" and delete all their orders? Future emails from this sender will be ignored.`)) return;
    try {
      const res = await fetch('/api/blocked-senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: senderEmail,
          blocked_by: currentUser!.name,
          reason: 'Blocked from shipping tracker',
          delete_orders: true,
          user_id: currentUser!.id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Blocked ${senderEmail}. ${data.ordersDeleted} order(s) removed.`);
        await fetchOrders();
      } else {
        alert('Failed to block sender: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Failed to block sender: ' + err);
    }
  }

  async function handleViewLog(orderId?: number) {
    try {
      const url = orderId ? `/api/changelog?orderId=${orderId}` : '/api/changelog';
      const res = await fetch(url);
      const data = await res.json();
      setChangeLogEntries(data);
      setChangeLogTitle(orderId ? 'Order Change History' : 'All Recent Changes');
      setShowChangeLog(true);
    } catch (err) {
      alert('Failed to load change log: ' + err);
    }
  }

  // Filter orders
  const filteredOrders = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        o.vendor.toLowerCase().includes(q) ||
        o.description.toLowerCase().includes(q) ||
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.tracking_number || '').toLowerCase().includes(q) ||
        (o.project || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const isAdmin = currentUser?.role === 'admin';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p style={{ color: 'var(--evo-gray-400)' }}>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center p-8">
          <p className="text-red-600 font-medium mb-2">Connection Error</p>
          <p className="text-sm mb-4" style={{ color: 'var(--evo-gray-500)' }}>{error}</p>
          <a
            href="/api/setup"
            className="text-sm underline"
            style={{ color: 'var(--evo-blue)' }}
            onClick={async (e) => {
              e.preventDefault();
              await fetch('/api/setup', { method: 'POST' });
              window.location.reload();
            }}
          >
            Run Database Setup
          </a>
        </div>
      </div>
    );
  }

  // Name selection
  if (!currentUser) {
    return <NameSelector employees={employees} onSelect={setCurrentUser} />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header
        className="px-6 py-4 flex items-center justify-between shadow-sm"
        style={{ background: 'var(--evo-navy)' }}
      >
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Evolution Shipping Tracker</h1>
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <a
              href="/admin"
              className="text-sm text-blue-300 hover:text-white transition-colors"
            >
              Manage Employees
            </a>
          )}
          <button
            onClick={() => handleViewLog()}
            className="text-sm text-blue-300 hover:text-white transition-colors"
          >
            View Change Log
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-blue-200">{currentUser.name}</span>
            {isAdmin && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600 text-blue-100">Admin</span>
            )}
            <button
              onClick={() => setCurrentUser(null)}
              className="text-xs text-blue-400 hover:text-white ml-1"
            >
              Switch
            </button>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 border-b" style={{ borderColor: 'var(--evo-gray-200)' }}>
        <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search orders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm flex-1 sm:max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
            style={{ borderColor: 'var(--evo-gray-300)' }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            style={{ borderColor: 'var(--evo-gray-300)' }}
          >
            <option value="all">All Statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--evo-gray-400)' }}>
            {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
          </span>
          {isAdmin && (
            <button
              onClick={() => {
                setEditingOrder(null);
                setShowOrderModal(true);
              }}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors hover:opacity-90"
              style={{ background: 'var(--evo-blue)' }}
            >
              + Add Order
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--evo-gray-100)' }}>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--evo-gray-600)' }}>Vendor</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--evo-gray-600)' }}>Description</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--evo-gray-600)' }}>Project</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--evo-gray-600)' }}>From</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--evo-gray-600)' }}>Status</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--evo-gray-600)' }}>Carrier</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--evo-gray-600)' }}>Tracking</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--evo-gray-600)' }}>Est. Delivery</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--evo-gray-600)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center" style={{ color: 'var(--evo-gray-400)' }}>
                  {orders.length === 0
                    ? 'No orders yet. Add one to get started.'
                    : 'No orders match your filters.'}
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  className="border-b hover:bg-blue-50/40 transition-colors"
                  style={{ borderColor: 'var(--evo-gray-100)' }}
                >
                  <td className="px-4 py-3 font-medium">{order.vendor}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--evo-gray-700)' }}>
                    <div>{order.description}</div>
                    {order.order_number && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--evo-gray-400)' }}>
                        #{order.order_number}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--evo-gray-600)' }}>
                    {order.project || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--evo-gray-500)' }}>
                    {order.sender_email || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${statusClass(order.status)}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--evo-gray-600)' }}>
                    {order.carrier || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {order.tracking_number ? (
                      <span className="font-mono text-xs" style={{ color: 'var(--evo-gray-700)' }}>
                        {order.tracking_number}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--evo-gray-400)' }}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--evo-gray-600)' }}>
                    {formatDate(order.estimated_delivery)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setEditingOrder(order);
                          setShowOrderModal(true);
                        }}
                        className="text-xs px-2 py-1 rounded border transition-colors hover:bg-gray-50"
                        style={{ borderColor: 'var(--evo-gray-300)', color: 'var(--evo-gray-600)' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleViewLog(order.id)}
                        className="text-xs px-2 py-1 rounded border transition-colors hover:bg-gray-50"
                        style={{ borderColor: 'var(--evo-gray-300)', color: 'var(--evo-gray-600)' }}
                      >
                        Log
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => handleDeleteOrder(order.id)}
                            className="text-xs px-2 py-1 rounded border border-red-200 text-red-500 transition-colors hover:bg-red-50"
                          >
                            Delete
                          </button>
                          {order.sender_email && (
                            <button
                              onClick={() => handleBlockSender(order)}
                              className="text-xs px-2 py-1 rounded border border-orange-200 text-orange-600 transition-colors hover:bg-orange-50"
                            >
                              Block
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <footer className="px-6 py-3 border-t text-xs flex items-center justify-between" style={{ borderColor: 'var(--evo-gray-200)', color: 'var(--evo-gray-400)' }}>
        <span>Evolution Shipping Tracker</span>
        <span>Auto-refreshes every 30s</span>
      </footer>

      {/* Modals */}
      {showOrderModal && (
        <OrderModal
          order={editingOrder}
          currentUser={currentUser.name}
          isAdmin={isAdmin}
          onSave={handleSaveOrder}
          onClose={() => {
            setShowOrderModal(false);
            setEditingOrder(null);
          }}
        />
      )}
      {showChangeLog && (
        <ChangeLog
          entries={changeLogEntries}
          title={changeLogTitle}
          onClose={() => setShowChangeLog(false)}
        />
      )}
    </div>
  );
}
