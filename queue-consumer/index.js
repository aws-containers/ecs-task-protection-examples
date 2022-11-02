import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
const sqs = new SQSClient();

import got from 'got';

const QUEUE_URL = process.env.COPILOT_QUEUE_URI;
if (!QUEUE_URL) {
  throw new Error('COPILOT_QUEUE_URI environment variable must be set so that the worker knows what queue to watch');
}

const ECS_AGENT_URI = process.env.ECS_AGENT_URI;
if (!ECS_AGENT_URI) {
  throw new Error('ECS_AGENT_URI environment variable must be set. This is set automatically in an ECS task environment');
}

const ONE_HOUR_IN_SECONDS = 60 * 60;
const ONE_HOUR_IN_MINUTES = 60;
const THIRTY_MINS_IN_MS = 30 * 60 * 1000;
var timeToQuit = false;

function maybeContinuePolling() {
  if (timeToQuit) {
    console.log('Exiting as requested');
    process.exit(0);
  } else {
    setImmediate(pollForWork);
  }
}

async function receiveMessage() {
  // Get a message if there is a message waiting in SQS.
  var receiveMessageResponse;
  try {
    console.log("Polling for messages");
    receiveMessageResponse = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20, // Wait up to 20 seconds on the SQS server side for messages to arrive
      VisibilityTimeout: ONE_HOUR_IN_SECONDS // Reserve received messages for one hour
    }));
  } catch (e) {
    // Error response from the SQS service
    console.error('Failed to receive messages because ', e);
    return;
  }

  var messages = receiveMessageResponse.Messages;
  if (!messages) {
    // Empty response, no work to do.
    return;
  }

  return messages[0];
}

async function deleteMessage(handle) {
  try {
    await sqs.send(new DeleteMessageCommand({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: handle
    }));
  } catch (e) {
    console.error('Failed to delete handled message because ', e)
  }
}

async function enableTaskProtection() {
  return await got.post(`${ECS_AGENT_URI}/task-protection/v1/state`, {
    json: {
      ProtectionEnabled: true,
      ExpiresInMinutes: ONE_HOUR_IN_MINUTES
    }
  });
}

async function disableTaskProtection() {
  return await got.post(`${ECS_AGENT_URI}/task-protection/v1/state`, {
    json: {
      ProtectionEnabled: false
    }
  });
}

async function pollForWork() {
  try {
    var response = await enableTaskProtection();
  } catch (e) {
    console.log('ECS did not allow task to protect itself because ', e);
    timeToQuit = true;
    return maybeContinuePolling();
  }
  console.log(response);

  var message = await receiveMessage();

  if (!message) {
    return maybeContinuePolling();
  }

  console.log(`${message.MessageId} - Received`);

  var waitPeriod = Number(message.Body);
  if (waitPeriod === NaN) {
    waitPeriod = 1000;
  }

  console.log(`${message.MessageId} - Working for ${waitPeriod} milliseconds`);

  // Wait for a while to simulate some computationally
  // heavy work being done.
  await new Promise(function (done) {
    setTimeout(done, waitPeriod);
  });

  await deleteMessage(message.ReceiptHandle);

  console.log(`${message.MessageId} - Done`);

  await disableTaskProtection();

  return maybeContinuePolling();
}

process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, will quit when all work is done');
  timeToQuit = true;
});

setImmediate(pollForWork);