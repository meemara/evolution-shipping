'use client';

import { useState, useEffect } from 'react';

interface Employee {
  id: number;
  name: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

export default function AdminPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'viewer' | 'admin'>('viewer');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'viewer' | 'admin'>('viewer');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  async function fetchEmployees() {
    try {
      const res = await fetch('/api/employees');
      const data = await res.json();
      setEmployees(data);
    } catch {
      setMessage({ text: 'Failed to load employees', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEmployees();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), role: newRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to add');
      }
      setNewName('');
      setNewRole('viewer');
      setMessage({ text: `${newName.trim()} added successfully`, type: 'success' });
      await fetchEmployees();
    } catch (err) {
      setMessage({ text: String(err), type: 'error' });
    }
  }

  async function handleUpdate(id: number) {
    try {
      const res = await fetch(`/api/employees/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), role: editRole }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setEditingId(null);
      setMessage({ text: 'Employee updated', type: 'success' });
      await fetchEmployees();
    } catch (err) {
      setMessage({ text: String(err), type: 'error' });
    }
  }

  async function handleDelete(emp: Employee) {
    if (!confirm(`Remove ${emp.name} from the tracker?`)) return;
    try {
      await fetch(`/api/employees/${emp.id}`, { method: 'DELETE' });
      setMessage({ text: `${emp.name} removed`, type: 'success' });
      await fetchEmployees();
    } catch (err) {
      setMessage({ text: String(err), type: 'error' });
    }
  }

  function startEdit(emp: Employee) {
    setEditingId(emp.id);
    setEditName(emp.name);
    setEditRole(emp.role);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p style={{ color: 'var(--evo-gray-400)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between shadow-sm" style={{ background: 'var(--evo-navy)' }}>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Manage Employees</h1>
        </div>
        <a href="/" className="text-sm text-blue-300 hover:text-white transition-colors">
          ← Back to Tracker
        </a>
      </header>

      <div className="max-w-2xl mx-auto w-full px-6 py-8">
        {/* Message */}
        {message && (
          <div
            className={`mb-6 px-4 py-3 rounded-lg text-sm ${
              message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {message.text}
            <button onClick={() => setMessage(null)} className="float-right font-medium">×</button>
          </div>
        )}

        {/* Add Employee Form */}
        <div className="bg-white rounded-xl border p-6 mb-8" style={{ borderColor: 'var(--evo-gray-200)' }}>
          <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--evo-navy)' }}>Add Employee</h2>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full name"
              required
              className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              style={{ borderColor: 'var(--evo-gray-300)' }}
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'viewer' | 'admin')}
              className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              style={{ borderColor: 'var(--evo-gray-300)' }}
            >
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg text-white text-sm font-medium transition-colors hover:opacity-90"
              style={{ background: 'var(--evo-blue)' }}
            >
              Add
            </button>
          </form>
        </div>

        {/* Employee List */}
        <div className="bg-white rounded-xl border" style={{ borderColor: 'var(--evo-gray-200)' }}>
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--evo-gray-200)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--evo-navy)' }}>
              Current Employees ({employees.length})
            </h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--evo-gray-100)' }}>
            {employees.map((emp) => (
              <div key={emp.id} className="px-6 py-4 flex items-center justify-between">
                {editingId === emp.id ? (
                  <div className="flex flex-1 flex-col sm:flex-row gap-3 mr-4">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      style={{ borderColor: 'var(--evo-gray-300)' }}
                    />
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as 'viewer' | 'admin')}
                      className="px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      style={{ borderColor: 'var(--evo-gray-300)' }}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdate(emp.id)}
                        className="px-3 py-1.5 rounded-lg text-white text-xs font-medium"
                        style={{ background: 'var(--evo-blue)' }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border"
                        style={{ borderColor: 'var(--evo-gray-300)', color: 'var(--evo-gray-600)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <span className="font-medium text-sm">{emp.name}</span>
                      <span
                        className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                          emp.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {emp.role === 'admin' ? 'Admin' : 'Viewer'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEdit(emp)}
                        className="text-xs px-2 py-1 rounded border transition-colors hover:bg-gray-50"
                        style={{ borderColor: 'var(--evo-gray-300)', color: 'var(--evo-gray-600)' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(emp)}
                        className="text-xs px-2 py-1 rounded border border-red-200 text-red-500 transition-colors hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs mt-6 text-center" style={{ color: 'var(--evo-gray-400)' }}>
          Admins can add/edit/delete orders. Viewers can update shipping status and notes only.
        </p>
      </div>
    </div>
  );
}
