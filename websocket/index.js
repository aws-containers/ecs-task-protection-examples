import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
const server = http.Server(app);
const wss = new WebSocketServer({ server });

import ProtectionManager from './lib/protection-manager.js';
const TaskProtection = new ProtectionManager({
  // Protect task for 30 min at a time when protection is acquired
  desiredProtectionDurationInMins: 30,
  // Release task protection right away when no one is connected.
  // If there are frequent connection and disconnection, then setting this
  // higher will help avoid rate limiting on task protection.
  maintainProtectionPercentage: 0,
  // At the 80% mark go ahead and preemptively refresh the protection. This
  // keeps protection going if a web socket client stays connected for a long time.
  refreshProtectionPercentage: 80,
  // Check every 10 seconds to see if protection state should be adjusted.
  protectionAdjustIntervalInMs: 10 * 1000
});

var connections = 0;

async function protectTask() {
  // Refresh the ECS task protection if there are live
  // connected clients to this websocket server.
  if (connections > 0) {
    await TaskProtection.acquire();
  } else {
    TaskProtection.release();
  }
}

TaskProtection.on('protected', function () {
  console.log('Task protection acquired');
});

TaskProtection.on('unprotected', function () {
  console.log('Task protection released');
});

TaskProtection.on('rejected', function () {
  console.log('Task protection rejected');

  // Notify all connected clients that task protection was
  // rejected, therefore it will expire soon and the server
  // will shutdown.
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send('server shutting down soon');
    }
  });
});

wss.on('connection', function connection(ws) {
  connections++;
  console.log(`New client connection opened. There are ${connections} connections`);
  protectTask(); // Check to see if we need to protect the task

  ws.on('message', function message(data) {
    console.log('received: %s', data);

    if (data.toString() === 'ping') {
      ws.send('pong')
    }
  });

  ws.send(`Welcome! There are ${connections} connections`);

  ws.on('close', async function () {
    connections--;
    console.log(`Client connection closed. There are ${connections} connections`);
    protectTask(); // Check to see if we still need to protect the task
  });
});

// Path to serve the static HTML client app that connects to this server
app.use(express.static('public'))

// This supplies a route for the application load balancer
// to healthcheck on.
app.get('/', function (req, res) {
  res.send('Healthy');
});

server.listen(3000);