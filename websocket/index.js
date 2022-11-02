import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const server = http.Server(app);
const wss = new WebSocketServer({ server });

var connections = 0;

async function protectTask() {
  // Refresh the ECS task protection if there are live
  // connected clients to this websocket server.
  if (connections > 0) {
    console.log(`Protecting this task because there are ${connections} clients connected`);
  } else {
    console.log(`Clearing task protection because there are no connected clients`);
  }
}

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

  ws.on('close', function () {
    connections--;
    console.log(`Client connection closed. There are ${connections} connections`);
    protectTask(); // Check to see if we need to protect the task
  });
});

// Path to serve the static HTML client app that connects to this server
app.use(express.static('public'))

// This supplies a route for the application load balancer
// to healthcheck on.
app.get('/', function (req, res) {
  res.send('Healthy');
});

var taskProtectionInterval = setInterval(protectTask, 60 * 1000); // Once per minute
protectTask();

process.on('SIGTERM', function () {
  // Stop refreshing the task protection and let it expire.
  clearInterval(taskProtectionInterval);
});

server.listen(80);