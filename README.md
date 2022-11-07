# Elastic Container Service (ECS) Task Protection Examples

This repository contains two sample applications that demonstrate
the usage of the ECS task protection feature.

## Prerequisites

You should install AWS Copilot, as this is the official command line
tool for Elastic Container Service, which will be used to deploy the
demo applications.

## Queue Consumer

This application simulates a worker grabbing jobs off of an SQS queue.
You can configure how long each simulated job takes by passing a duration
in the body of the SQS message. The worker will set task protection on itself
before and during each job, then release task protection after processing each job.

Deploy with AWS Copilot by typing `copilot init` and make the following choices:

```
Use existing application: No
Application name: task-protection
Workload type: Worker Service
Service name: queue-consumer
Dockerfile: queue-consumer/Dockerfile
```

## Websocket Server

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