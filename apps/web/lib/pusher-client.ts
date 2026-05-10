import Pusher from 'pusher-js';

let client: Pusher | null = null;

export function getPusherClient(): Pusher {
  if (!client) {
    client = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    });
  }
  return client;
}

export function subscribeToHousehold(
  code: string,
  handlers: {
    onIncidentNew?: (data: any) => void;
    onIncidentUpdate?: (data: any) => void;
    on911Prompt?: (data: any) => void;
    onSensorStatus?: (data: any) => void;
    onMonitoringUpdate?: (data: any) => void;
  }
) {
  const pusher = getPusherClient();
  const channel = pusher.subscribe(`household-${code}`);

  if (handlers.onIncidentNew) channel.bind('incident:new', handlers.onIncidentNew);
  if (handlers.onIncidentUpdate) channel.bind('incident:update', handlers.onIncidentUpdate);
  if (handlers.on911Prompt) channel.bind('incident:911_prompt', handlers.on911Prompt);
  if (handlers.onSensorStatus) channel.bind('sensor:status', handlers.onSensorStatus);
  if (handlers.onMonitoringUpdate) channel.bind('monitoring:update', handlers.onMonitoringUpdate);

  return () => {
    channel.unbind_all();
    pusher.unsubscribe(`household-${code}`);
  };
}
