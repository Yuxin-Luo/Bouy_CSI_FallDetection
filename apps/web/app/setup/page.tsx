'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ code: '', name: '', phone: '', role: 'contact' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user } = await api.joinHousehold(form);
      // Store user info in localStorage for this session
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('householdCode', form.code);

      if (user.role === 'at_risk') {
        router.push(`/household/${form.code}/at-risk`);
      } else {
        router.push(`/household/${form.code}/contact`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-gray-950 text-white">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-1">Join Household</h1>
        <p className="text-gray-400 text-sm mb-6">Enter your 6-digit household code to connect</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Household Code</label>
            <input
              className="w-full bg-gray-800 rounded-lg px-4 py-3 text-white text-lg tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. 483920"
              value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              required
              maxLength={10}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Your Name</label>
            <input
              className="w-full bg-gray-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Jane Smith"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Phone Number</label>
            <input
              className="w-full bg-gray-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="+1 555 000 0000"
              type="tel"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">I am a...</label>
            <div className="flex gap-3">
              {(['at_risk', 'contact'] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, role: r }))}
                  className={`flex-1 py-3 rounded-lg font-medium transition ${
                    form.role === r
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {r === 'at_risk' ? 'At-Risk Person' : 'Emergency Contact'}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-4 rounded-xl text-lg transition mt-2"
          >
            {loading ? 'Joining...' : 'Join Household'}
          </button>
        </form>
      </div>
    </main>
  );
}
