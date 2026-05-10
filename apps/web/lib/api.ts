const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function req(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  joinHousehold: (body: { code: string; name: string; phone: string; role: string }) =>
    req('/api/households/join', { method: 'POST', body: JSON.stringify(body) }),

  getHousehold: (code: string) =>
    req(`/api/households/${code}`),

  getIncidents: (code: string) =>
    req(`/api/households/${code}/incidents`),

  getIncident: (id: string) =>
    req(`/api/incidents/${id}`),

  respond: (incidentId: string, response: 'ok' | 'help') =>
    req(`/api/incidents/${incidentId}/respond`, { method: 'POST', body: JSON.stringify({ response }) }),

  ack: (incidentId: string, contactName: string) =>
    req(`/api/incidents/${incidentId}/ack`, { method: 'POST', body: JSON.stringify({ contactName }) }),

  resolve: (incidentId: string, contactName: string) =>
    req(`/api/incidents/${incidentId}/resolve`, { method: 'POST', body: JSON.stringify({ contactName }) }),

  trigger911: (incidentId: string) =>
    req(`/api/incidents/${incidentId}/911`, { method: 'POST' }),

  simulateFall: (deviceId: string, confidence = 0.9) =>
    req('/api/incidents/detect', {
      method: 'POST',
      body: JSON.stringify({
        device_id: deviceId,
        event_type: 'fall_suspected',
        confidence,
        timestamp: new Date().toISOString(),
      }),
    }),

  getProfile: (code: string) =>
    req(`/api/households/${code}/profile`),

  updateProfile: (code: string, resident_name: string) =>
    req(`/api/households/${code}/profile`, { method: 'PATCH', body: JSON.stringify({ resident_name }) }),

  getCaregivers: (code: string) =>
    req(`/api/households/${code}/caregivers`),

  addCaregiver: (code: string, body: { name: string; role: string; phone: string }) =>
    req(`/api/households/${code}/caregivers`, { method: 'POST', body: JSON.stringify(body) }),

  updateCaregiver: (code: string, id: string, body: { name: string; role: string; phone: string }) =>
    req(`/api/households/${code}/caregivers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteCaregiver: (code: string, id: string) =>
    req(`/api/households/${code}/caregivers/${id}`, { method: 'DELETE' }),

  getDeviceState: (deviceId: string) =>
    req(`/api/devices/${deviceId}/state`),

  requestMonitoringPause: (code: string) =>
    req(`/api/households/${code}/monitoring/request`, { method: 'POST' }),

  approveMonitoringPause: (code: string) =>
    req(`/api/households/${code}/monitoring/approve`, { method: 'POST' }),

  resumeMonitoring: (code: string) =>
    req(`/api/households/${code}/monitoring/resume`, { method: 'POST' }),

  postTelemetry: (deviceId: string, payload: object) =>
    req('/api/telemetry', { method: 'POST', body: JSON.stringify({ device_id: deviceId, event_type: 'heartbeat', ...payload }) }),
};
