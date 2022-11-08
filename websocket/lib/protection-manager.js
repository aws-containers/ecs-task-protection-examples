import got from 'got';
import { EventEmitter } from 'node:events';

// This class manages the task protection state. It implements basic
// rate limiting, and emits events to let you know when it changes state.
// you can await the acquire() and release() methods if you want to ensure
// that task protection has reached the desired state before moving on.
export default class ProtectionManager extends EventEmitter {
  /**
   * @constructor
   * @param {*} protectionSettings
   * @param {*} protectionSettings.desiredProtectionDurationInMins - How long in minutes to protect the process on calling the acquire method
   * @param {*} protectionSettings.maintainProtectionPercentage - Number between 0 and 100 that expresses percentage of desired protection to maintain if release is called early
   * @param {*} protectionSettings.refreshProtectionPercentage - Number between 0 and 100 that expresses percentage of desired protection duration to let pass before doing an early refresh
   * @param {*} protectionSettings.protectionAdjustIntervalInMs - How frequently in ms to attempt/verify state matches desire
   */
  constructor(protectionSettings) {
    super();
    this.desiredProtectionDurationInMins = protectionSettings.desiredProtectionDurationInMins;
    this.protectionAdjustIntervalInMs = protectionSettings.protectionAdjustIntervalInMs;
    this.maintainProtectionPercentage = protectionSettings.maintainProtectionPercentage;
    this.refreshProtectionPercentage = protectionSettings.refreshProtectionPercentage;
    this.ECS_AGENT_URI = process.env.ECS_AGENT_URI;

    if (!this.ECS_AGENT_URI) {
      throw new Error('ECS_AGENT_URI environment variable must be set. This is set automatically in an ECS task environment');
    }

    this.desiredState = 'unprotected';
    this.currentState = 'unprotected';
    this.lastStateChange = new Date().getTime();
    this.interval = setInterval(this.attemptAdjustProtection.bind(this), protectionSettings.protectionAdjustIntervalInMs);
  }

  attemptAdjustProtection = async function () {
    if (this.currentState == 'unprotected' &&
      this.desiredState == 'unprotected') {
      // Already unprotected so nothing to do right now.
      this.emit(this.currentState);
      return;
    }

    var now = new Date().getTime();
    var timeSinceLastChange = now - this.lastStateChange;
    var timeUntilProtectRefresh = this.desiredProtectionDurationInMins * 60 * 1000 * (this.refreshProtectionPercentage / 100);
    var timeUntilProtectRelease = this.desiredProtectionDurationInMins * 60 * 1000 * (this.maintainProtectionPercentage / 100);

    if (this.currentState == 'protected' &&
      this.desiredState == 'protected' &&
      timeSinceLastChange < timeUntilProtectRefresh) {
      // We are already protected and haven't yet reached 80% of the acquired protection duration
      // so no need to do an early refresh.
      this.emit(this.currentState);
      return;
    }

    if (this.currentState == 'protected' &&
      this.desiredState == 'unprotected' &&
      timeSinceLastChange < timeUntilProtectRelease) {
      // We are currently protected and not enough duration has passed since we became protected
      // so don't actually release the protection yet, maintain it for now.
      this.emit(this.currentState);
      return;
    }

    var ecsAgentParams;
    if (this.desiredState == 'unprotected') {
      ecsAgentParams = {
        ProtectionEnabled: false
      };
    } else if (this.desiredState == 'protected') {
      ecsAgentParams = {
        ProtectionEnabled: true,
        ExpiresInMinutes: this.desiredProtectionDurationInMins
      };
    }

    try {
      await got(`${this.ECS_AGENT_URI}/task-protection/v1/state`, {
        method: 'PUT',
        json: ecsAgentParams
      });
    } catch (e) {
      return this.emit('rejected', e);
    }

    this.lastStateChange = new Date().getTime();
    this.currentState = this.desiredState;
    this.emit(this.currentState);
  }

  /**
   * Set the desired state to protected and wait for protection to be successfully acquired
   */
  acquire = async function () {
    var self = this;
    this.desiredState = 'protected';
    return new Promise(function (resolve, reject) {
      self.once('protected', resolve);
      self.attemptAdjustProtection(); // Immediate attempt to make an adjustment
    });
  }

  /**
   * Set the desired state to unprotected and wait for protection to be successfully released
   */
  release = async function () {
    var self = this;
    this.desiredState = 'unprotected';
    return new Promise(function (resolve, reject) {
      self.once('unprotected', resolve);
      self.attemptAdjustProtection(); // Immediate attempt to make an adjustment
    });
  }

  /**
   * When it is time to stop the process this clears
   * the interval so that it no longer keeps the event loop alive.
   */
  close = function () {
    clearInterval(this.interval);
  }
}
