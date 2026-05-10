// Shared mock data for the Hearth fall-detection app.

export const houseProfile = {
  name: "Mom's Place",
  resident: "Margaret Whitford",
  description:
    "Four-room apartment with an open living room and one shared hallway.",
  address: "Apt 4B · 218 Linden Ave",
  primaryGroup: "Whitford Family",
};

export type RoomType = "bedroom" | "living" | "hallway";

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Layout: four square rooms in a row + open living between R2 and R3,
// hallway running underneath all of them.
export const rooms: Room[] = [
  { id: "r1", name: "Room 1", type: "bedroom", x: 20, y: 20, width: 100, height: 100 },
  { id: "r2", name: "Room 2", type: "bedroom", x: 130, y: 20, width: 100, height: 100 },
  { id: "open", name: "Open Living", type: "living", x: 240, y: 20, width: 120, height: 100 },
  { id: "r3", name: "Room 3", type: "bedroom", x: 370, y: 20, width: 100, height: 100 },
  { id: "r4", name: "Room 4", type: "bedroom", x: 480, y: 20, width: 100, height: 100 },
  { id: "hall", name: "Hallway", type: "hallway", x: 20, y: 130, width: 560, height: 40 },
];

export type SensorStatus = "online" | "degraded" | "offline";

export interface Sensor {
  id: string;
  roomId: string;
  // Coordinates relative to the SVG canvas (same space as rooms).
  x: number;
  y: number;
  status: SensorStatus;
  packetRate: number; // packets/sec
  rssi: number; // dBm
  lastSeen: string;
  calibration: "ok" | "needs_recheck";
  kind: "TX" | "RX";
}

export const sensors: Sensor[] = [
  { id: "TX",  roomId: "open", x: 260, y: 45,  status: "online",   packetRate: 48, rssi: -52, lastSeen: "just now",  calibration: "ok", kind: "TX" },
  { id: "RX1", roomId: "open", x: 290, y: 95,  status: "online",   packetRate: 47, rssi: -58, lastSeen: "just now",  calibration: "ok", kind: "RX" },
  { id: "RX2", roomId: "open", x: 330, y: 45,  status: "degraded", packetRate: 31, rssi: -71, lastSeen: "4 min ago", calibration: "needs_recheck", kind: "RX" },
  { id: "RX3", roomId: "open", x: 340, y: 95,  status: "online",   packetRate: 46, rssi: -60, lastSeen: "just now",  calibration: "ok", kind: "RX" },
];

export type EventType =
  | "possible_fall"
  | "confirmed_fall"
  | "false_alarm"
  | "presence"
  | "no_motion"
  | "sensor_offline";

export type ReviewStatus = "needs_review" | "real_fall" | "false_alarm" | "informational";

export interface NotificationEvent {
  id: string;
  type: EventType;
  roomId: string;
  sensorId?: string;
  time: string;
  date: string;
  confidence?: number; // 0-1
  status: ReviewStatus;
  detail: string;
}

export const notifications: NotificationEvent[] = [
  { id: "n1", type: "possible_fall",  roomId: "open", sensorId: "RX1", time: "3:42 PM", date: "Today",     confidence: 0.78, status: "needs_review", detail: "Sudden vertical drop detected near sofa." },
  { id: "n2", type: "presence",       roomId: "open", sensorId: "RX3", time: "3:12 PM", date: "Today",     status: "informational", detail: "Presence detected in Open Living." },
  { id: "n3", type: "sensor_offline", roomId: "open", sensorId: "RX2", time: "1:08 PM", date: "Today",     status: "informational", detail: "RX2 packet rate dropped below threshold." },
  { id: "n4", type: "no_motion",      roomId: "r1",   sensorId: "RX1", time: "11:20 AM", date: "Today",    status: "informational", detail: "No motion in Room 1 for 2 hours." },
  { id: "n5", type: "false_alarm",    roomId: "open", sensorId: "RX1", time: "8:55 PM", date: "Yesterday", confidence: 0.62, status: "false_alarm", detail: "Marked as false alarm by Sarah." },
  { id: "n6", type: "confirmed_fall", roomId: "open", sensorId: "RX3", time: "7:14 AM", date: "May 6",     confidence: 0.91, status: "real_fall", detail: "Confirmed fall — emergency contact called." },
];

export type Priority = "primary" | "backup" | "emergency";
export interface Caregiver {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  push: boolean;
  sms: boolean;
  emergencyCall: boolean;
  priority: Priority;
}

export const caregivers: Caregiver[] = [
  { id: "c1", name: "Sarah Whitford", role: "Daughter",          phone: "(415) 555-0142", email: "sarah@whitford.co", push: true,  sms: true,  emergencyCall: true,  priority: "primary" },
  { id: "c2", name: "James Okafor",   role: "Home carer",        phone: "(415) 555-0177", email: "james@hearthcare.com", push: true,  sms: true,  emergencyCall: false, priority: "backup" },
  { id: "c3", name: "Dr. Eleanor Chen", role: "Primary physician", phone: "(415) 555-0190", email: "echen@bayclinic.org", push: false, sms: true,  emergencyCall: false, priority: "backup" },
  { id: "c4", name: "Emergency Services", role: "911 dispatch",  phone: "911",            email: "—",                  push: false, sms: false, emergencyCall: true,  priority: "emergency" },
];

export const escalation = [
  { delay: "0s",   action: "Notify primary caregiver via push + SMS" },
  { delay: "30s",  action: "Notify backup caregivers if no response" },
  { delay: "60s",  action: "Place emergency call to 911" },
];
