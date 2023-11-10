# Elastic Container Service (ECS) Task Protection Examples

This repository contains two sample applications that demonstrate
the usage of the ECS task protection feature. You can find detailed deployment
instructions and other related resources at the [Containers on AWS pattern: "Background worker that gets jobs from an SQS queue"](https://containersonaws.com/pattern/background-worker-sqs-queue-container-copilot)

## Prerequisites

To deploy these samples you must install [AWS Copilot](https://aws.github.io/copilot-cli/),
the official command line tool for Elastic Container Service.

Additionally you need to have Docker installed locally for building the container images.

Examples are written in Node.js but there is no need to have Node installed locally
as all Node.js usage will happen inside the container image.

## `ProtectionManager` class

The code for both demo apps is utilizing the same JS wrapper class
called [`ProtectionManager`](/queue-consumer/lib/protection-manager.js).

This class is responsible for calling the ECS API on your behalf to set the task
protection state.

__Usage:__

```js
import ProtectionManager from './lib/protection-manager.js';
const TaskProtection = new ProtectionManager({
  // Duration to protect the task for each time task protection is
  // set or refreshed
  desiredProtectionDurationInMins: 5,

  // If protection is released before X% of the duration has passed
  // then keep the protection going. This is useful in case you have
  // short duration jobs or a mix of short and long duration jobs, as
  // there is a rate limit on often you can set and unset task protection.
  maintainProtectionPercentage: 10,

  // At the X% mark go ahead and preemptively refresh the protection. This
  // keeps protection going if a particular job or socket connection takes too long
  // so protection is going to expire too early. The manager class will
  // automatically extend the protection at this point.
  refreshProtectionPercentage: 80,

  // How many ms to wait between checks
  protectionAdjustIntervalInMs: 10 * 1000
});
```

Once instantiated the `ProtectionManager` has the following methods that can be used
to acquire or release task protection based on what your application is doing:

```js
const TaskProtection = new ProtectionManager(settings);

async function main() {
  await TaskProtection.acquire();

  // Do protected logic that you don't want to interrupt here

  TaskProtection.release();
}
```

Note that for full usage of the `ProtectionManager` class your protected
logic should not be event loop blocking. Ensure that you use asynchronous
methods or yield back to the event loop by breaking heavy workload up into
multiple smaller computational chunks with `setImmediate()`. This is necessary
so that the background interval inside the `ProtectionManager` can trigger
periodically to check if task protection needs to be extended during long
running jobs.

The `ProtectionManager` class is an `EventEmitter` so you
can bind to the following events to run your own custom logic when
task protection state changes:

```js
// Event triggers when task protection is acquired or
// task protection duration is refreshed
TaskProtection.on('protected', function() {

});

// Event triggers when task protection is released
TaskProtection.on('unprotected', function() {

});

// This can happen if Amazon ECS rejects your attempt to protect
// the task, which happens on rate limiting, or if a task blocks
// a rolling deployment for an extended period of time.
TaskProtection.on('rejected', function() {

});
```

## Queue Consumer

This application simulates a worker grabbing jobs off of an SQS queue.
You can configure how long each simulated job takes by passing a duration
in the body of the SQS message. The worker will set task protection on itself
before and during the processing of each job, then release task protection
after it finishes processing each job.

Deploy with AWS Copilot by typing `copilot init` and make the following choices:

```
Use existing application: No
Application name: task-protection
Workload type: Worker Service
Service name: queue-consumer
Dockerfile: queue-consumer/Dockerfile
```

AWS Copilot will automatically create an SQS queue and a container deployment
for the application. You can add work to the queue by navigating to the SQS
console, selecting the SQS queue and sending a message into it. You can put a number
into the body of the message which is the number of milliseconds you want that
job to take. For example `10000` is 10 seconds of time.

After submitting some work into the SQS queue check the logs for the worker queue
consumer application. You will see output similar to this:

```
2022-11-07T17:11:18.593-05:00	Acquiring task protection
2022-11-07T17:11:18.617-05:00	Long polling for messages
2022-11-07T17:11:37.641-05:00	0744dc66-c746-4561-ad38-7c2d90717d4a - Received
2022-11-07T17:11:37.641-05:00	0744dc66-c746-4561-ad38-7c2d90717d4a - Working for 10000 milliseconds
2022-11-07T17:11:47.655-05:00	0744dc66-c746-4561-ad38-7c2d90717d4a - Done
2022-11-07T17:11:47.655-05:00	Releasing task protection
2022-11-07T17:11:47.698-05:00	Task protection released
2022-11-07T17:11:47.698-05:00	Acquiring task protection
2022-11-07T17:11:47.725-05:00	Long polling for messages
2022-11-07T17:11:47.731-05:00	c701269a-07cd-4a83-bb71-3734c5306d88 - Received
2022-11-07T17:11:47.731-05:00	c701269a-07cd-4a83-bb71-3734c5306d88 - Working for 10000 milliseconds
2022-11-07T17:11:57.739-05:00	c701269a-07cd-4a83-bb71-3734c5306d88 - Done
2022-11-07T17:11:57.739-05:00	Releasing task protection
```

To test out task protection submit an SQS job with a longer duration, for example
`360000` (or 5 minutes). Then use the ECS console to edit the service and set
desired count to zero, to attempt to scale it down. You will observe the ECS task remaining
for some time, and see a message in the ECS service events tab saying something similar to this:

```
(service task-protection-test-queue-consumer-Service-tjlfn1NmI0yU, taskSet ecs-svc/6163164058718610164) was unable to scale in due to (reason 1 tasks under protection)
```

When the queue consumer finishes the simulated 5 minute task it will release the
task protection and ECS will then be able to stop the task. Alternatively you can
force kill the task immediately by selecting it and using the "Stop" action in the dropdown.

## WebSocket Server

This application simulates a persistent websocket connection server, such
as a game server or chat server. While there are connected clients the
process sets task protection on itself so that the server will not be
prematurely terminated and break connections if the ECS service decides to
scale in or do a rolling deployment.

Deploy with AWS Copilot by typing `copilot init` and make the following choices.
Note that if you have already created the `task-protection` application
by deploying the queue consumer service then you can reuse that existing application.

```
Use existing application: No
Application name: task-protection
Workload type: Load Balanced Application
Service name: websocket
Dockerfile: websocket/Dockerfile
```

AWS Copilot will deploy the websocket server behind an Application Load Balancer.
It will then output an autogenerated DNS name similar to:

```
http://task-Publi-A1IGB3OGHUZ4-998409289.us-east-2.elb.amazonaws.com
```

You can open the URL in your web browser to connect to the websocket server.

You will see activity messages in the browser tab like this:

```
Attempting to connect...
Connected!
Server says: "Welcome! There are 1 connections"
Client sent: "ping"
Server says: "pong"
Client sent: "ping"
Server says: "pong"
```

As long as there is at least one connected client the application will keep
its own task protected from scale in. If you look at the server side logs
for the application task you will messages similar to this:

```
2022-11-07T16:53:26.124-05:00	New client connection opened. There are 1 connections
2022-11-07T16:53:26.170-05:00	Task protection acquired
2022-11-07T16:53:28.153-05:00	received: ping
2022-11-07T16:53:30.153-05:00	received: ping
2022-11-07T16:53:32.156-05:00	received: ping
2022-11-07T16:53:32.451-05:00	Task protection acquired
2022-11-07T16:53:34.156-05:00	received: ping
2022-11-07T16:57:04.160-05:00	received: ping
2022-11-07T16:57:05.557-05:00	Client connection closed. There are 0 connections
2022-11-07T16:57:05.605-05:00	Task protection released
```

To test out task protection open a browser tab to the service to open a websocket connection between your browser and the the server.  Then edit the service in the ECS console and adjust desired count to zero.
Just as with the queue consumer service you will observe ECS waiting instead
of immediately stopping the task. You will also see a message in the service events tab
similar to this:

```
(service task-protection-test-websocket-Service-M9Q0bnYMjlQ4, taskSet ecs-svc/1888478596191510698) was unable to scale in due to (reason 1 tasks under protection)
```

## Cleanup

After you are done testing these demo applications you can use AWS Copilot to clean up
your account by running `copilot app delete`. This will delete the `task-protection` application
and both the `queue-worker` and `websocket` services deployed within the application.
