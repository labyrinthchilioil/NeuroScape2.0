import { useEffect, useState } from 'react';
import type { Status } from '../types';

export function useLive(initial: Status | null) {
  const [liveStatus, setLiveStatus] = useState<Status | null>(null);

  useEffect(() => {
    let reconnect: number | undefined;
    let socket: WebSocket | undefined;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/calibration`,
      );
      socket.onmessage = (event) =>
        setLiveStatus(JSON.parse(event.data).status);
      socket.onclose = () => {
        if (!disposed) reconnect = window.setTimeout(connect, 1500);
      };
    };
    // Deferring avoids opening and immediately closing a socket during React
    // Strict Mode's development-only effect probe.
    reconnect = window.setTimeout(connect, 0);
    return () => {
      disposed = true;
      if (reconnect !== undefined) window.clearTimeout(reconnect);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return liveStatus ?? initial;
}
