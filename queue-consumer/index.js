import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
var sqs;

if (process.env.QUEUE_REGION) {
  console.log(`Using queue in region ${process.env.QUEUE_REGION}`)
  sqs = new SQSClient({ region: process.env.QUEUE_REGION });
} else {
  sqs = new SQSClient();
}

const QUEUE_URL = process.env.COPILOT_QUEUE_URI;
if (!QUEUE_URL) {
  throw new Error('COPILOT_QUEUE_URI environment variable must be set so that the worker knows what queue to watch');
}

import ProtectionManager from './lib/protection-manager.js';
const TaskProtection = new ProtectionManager({
  // Protect task for 1 min at a time when protection is acquired
  desiredProtectionDurationInMins: 1,
  // If protection released early keep it going for a little while just in case another job arrives right away
  maintainProtectionPercentage: 10,
  // At the 80% mark go ahead and preemptively refresh the protection. This
  // keeps protection going if a job arrives that takes too long to process
  // so protection is going to expire before the job ends.
  refreshProtectionPercentage: 80,
  // Check every 10 seconds to see if protection state should be adjusted.
  protectionAdjustIntervalInMs: 10 * 1000
});

const ONE_HOUR_IN_SECONDS = 60 * 60;
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
    console.log("Long polling for messages");
    receiveMessageResponse = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20, // Wait up to 20 seconds on the SQS server side for messages to arrive
      VisibilityTimeout: ONE_HOUR_IN_SECONDS // Reserve received messages for one hour
    }));
  } catch (e) {
    // Error response from the SQS service
    console.error('Failed to receive messages because ', e.toString());
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
    console.error('Failed to delete handled message because ', e.toString())
  }
}

// Do the work for a single message.
async function processMessage(message) {
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
}

// Acquire task protection, grab a message, and then release protection
async function pollForWork() {
  console.log('Acquiring task protection');
  await TaskProtection.acquire();

  var message = await receiveMessage();

  if (message) {
    await processMessage(message);
  }

  console.log('Releasing task protection');

  await TaskProtection.release();
  return maybeContinuePolling();
}

process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, will quit when all work is done');
  timeToQuit = true;
});

TaskProtection.on('rejected', (e) => {
  if (e.response && e.response.body) {
    console.log('Failed to acquire task protection because ', e.response.body);
  } else {
    console.log('Failed to acquire task protection because ', e.toString())
  }
  timeToQuit = true;
});

TaskProtection.on('unprotected', (e) => {
  console.log('Task protection released');
});

setImmediate(pollForWork);