/**
 * InterceptorInterface.js
 * 
 * This class defines the interface that all language-specific interceptors must implement.
 * It provides the structure for intercepting external calls from sandboxed scripts.
 */

export class InterceptorInterface {
  constructor() {
    // Define required events that must be intercepted
    this.eventsToIntercept = [
      'fs_readFile',
      'fs_writeFile',
      'fs_unlink',
      'fs_stat',
      'http_request',
      'https_request',
      'fetch',
      'net_connect',
      'dns_lookup',
      'spawn',
      'exec',
      'websocket_connect'
    ];
    
    this._validateImplementation();
  }

  /**
   * Validates that all required methods are implemented
   * @private
   */
  _validateImplementation() {
    // Ensure that applyHooks method is implemented
    if (this.applyHooks === InterceptorInterface.prototype.applyHooks) {
      throw new Error('Required method "applyHooks" is not implemented');
    }

    // Ensure that sendIntercept method is implemented
    if (this.sendIntercept === InterceptorInterface.prototype.sendIntercept) {
      throw new Error('Required method "sendIntercept" is not implemented');
    }

    // Check if resetHooks is implemented (optional)
    if (this.resetHooks === undefined) {
      console.warn('Optional method "resetHooks" is not implemented');
    }
  }

  /**
   * Apply all hooks to intercept external calls
   * @abstract
   * @returns {boolean} True if all hooks were applied successfully
   */
  applyHooks() {
    throw new Error('Method "applyHooks" must be implemented');
  }

  /**
   * Send an intercepted call to the proxy
   * @abstract
   * @param {string} type - The type of event being intercepted
   * @param {Object} payload - The details of the intercepted call
   * @returns {Promise<any>} The response from the proxy
   */
  sendIntercept(type, payload) {
    throw new Error('Method "sendIntercept" must be implemented');
  }

  /**
   * Disable all hooks and restore original functionality
   * @abstract
   * @returns {boolean} True if all hooks were successfully reset
   */
  resetHooks() {
    throw new Error('Method "resetHooks" must be implemented');
  }

  /**
   * Validate that all required events are intercepted during initialization
   * @param {Array<string>} implementedEvents - Array of event names that are implemented
   */
  validateEvents(implementedEvents) {
    const missingEvents = this.eventsToIntercept.filter(event => !implementedEvents.includes(event));
    
    if (missingEvents.length > 0) {
      throw new Error(`Missing handlers for required events: ${missingEvents.join(', ')}`);
    }
    
    return true;
  }
} 