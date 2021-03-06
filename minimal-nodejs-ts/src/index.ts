import { ClientStatus, NstrumentaClient } from 'nstrumenta';
import ws from 'ws';

const nstClient = new NstrumentaClient();

const wsUrl = process.env.NSTRUMENTA_WS_URL || 'ws://localhost:8088';

setInterval(() => {
  if (nstClient.connection.status === ClientStatus.CONNECTED) {
    nstClient.send('time', { timestamp: Date.now() });
  }
}, 3000);

nstClient.addListener('open', () => {
  console.log('open');

  nstClient.addSubscription('time', (message) => {
    console.log(message);
  });
});

nstClient.connect({
  nodeWebSocket: ws as any,
  wsUrl,
});
