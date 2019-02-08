'use strict';

import '@babel/polyfill';
import './lib/runtime';

// Load NPM modules
import isPortFree from 'is-port-free';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import helmet from 'helmet';
import express from 'express';
import { shuffle } from 'lodash';

// Load package.json
import { version } from '../package.json';

// Load core operations
import serviceCoreOperations from './lib/core';

// Load classes
import LocalDatabase from './lib/db';
import ServiceCore from './lib';

// Load templates
import CommandBodyObject from './lib/template/command.js';
import ResponseBodyObject from './lib/template/response.js';

// Microservice options
const defaultServiceOptions = {
  loadBalancing: 'roundRobin',
  runOnStart: [],
  instances: 1
};

// HTTPS options
const buildSecureOptions = ssl => {
  try {
    return typeof ssl === 'object'
      ? Object.entries(
          Object.assign(
            {},
            {
              key: void 0,
              cert: void 0,
              ca: void 0
            },
            ssl
          )
        )
          .map(([optionKey, filePath]) => ({
            [optionKey]: fs.readFileSync(filePath)
          }))
          .reduce((acc, x) => Object.assign(acc, x), {})
      : ssl;
  } catch (e) {
    throw new Error(e);
  }
};

// HTTP options
const buildHttpOptions = options => ({
  port: 80,
  ssl: buildSecureOptions(options.ssl),
  harden: true,
  beforeStart: express => express,
  middlewares: [],
  static: [],
  routes: []
});

// Instance options
const defaultInstanceOptions = {
  mode: 'server',
  http: false,
  databaseNames: ['_defaultTable'],
  verbose: true,
  maxBuffer: 50, // in megabytes
  logPath: void 0,
  restartTimeout: 50,
  connectionTimeout: 1000,
  microServiceConnectionTimeout: 10000,
  microServiceConnectionAttempts: 1000,
  apiGatewayPort: 8080,
  portRangeStart: 1024,
  portRangeFinish: 65535,
  coreOperations: {},
  runOnStart: []
};

// Declare class
export class MicroServiceFramework extends ServiceCore {
  constructor(options) {
    // Super
    super(options);
    // Connection tracking number
    this.conId = 0;
    // Declare settings
    this.settings = Object.assign(
      defaultInstanceOptions,
      options,
      Array.isArray(options.http) && options.http.length
        ? options.http.map(httpSettings => buildHttpOptions(httpSettings))
        : false
    );
    // HTTP(s) and ports
    ['httpsServer', 'httpServer', 'inUsePorts'].forEach(prop => (this[prop] = []));
    // Initialise database
    this.db =
      this.settings.databaseNames
        .map(table => ({
          [table]: new LocalDatabase({
            databaseName: table
          }).db
        }))
        .reduce((acc, x) => Object.assign(acc, x), {}) || {};
    // Set process env settings
    process.env.settings = this.settings;
    process.env.exitedProcessPorts = [];
    // Store server external interfaces & service process
    ['externalInterfaces', 'coreOperations', 'serviceInfo', 'serviceOptions', 'serviceData'].forEach(
      prop => (this[prop] = {})
    );
    // Bind methods
    [
      'assignCoreFunctions',
      'startServerFailed',
      'startServer',
      'initGateway',
      'bindGateway',
      'hardenServer',
      'startHttpServer'
    ].forEach(func => (this[func] = this[func].bind(this)));
  }

  // FUNCTION: Start server failed
  startServerFailed() {
    return setTimeout(() => process.exit(), 0);
  }

  // FUNCTION: Start the server
  startServer() {
    return (async () => {
      try {
        if (['client', 'server'].includes(this.settings.mode)) {
          if (this.settings.mode === 'server') {
            await this.assignCoreFunctions();
            await this.initGateway();
            await this.bindGateway();
            await this.startServices();
            await this.startHttpServer();
            await this.executeInitialFunctions('coreOperations', 'settings');
            return void 0;
          }
          this.log(`Micro Service Framework: ${version}`, 'log');
          this.log('Running in client mode...', 'log');
          return void 0;
        }
        throw new Error("Unsupported mode detected. Valid options are 'server' or 'client'");
      } catch (e) {
        throw new Error(e);
      }
    })();
  }

  // FUNCTION: Assign core functions
  assignCoreFunctions() {
    return new Promise(resolve => {
      // Assign operations
      Object.entries(Object.assign({}, serviceCoreOperations, this.settings.coreOperations)).forEach(([name, func]) => {
        this.coreOperations[name] = func.bind(this);
      });
      // Resolve promise
      return resolve();
    });
  }

  // FUNCTION: Add micro service to the instance
  defineService(name, operations, options) {
    // Variables
    const resolvedPath = `${path.resolve(operations)}.js`;
    // Check that the server doesnt already exist
    switch (true) {
      case typeof name === 'undefined': {
        throw new Error(`The name of the microservice is not defined! ${name}`);
      }
      case typeof operations === 'undefined' || !fs.existsSync(resolvedPath): {
        throw new Error(
          `The operations path of the microservice is not defined or cannot be found! PATH: ${resolvedPath}`
        );
      }
      case typeof require(resolvedPath) !== 'object' || !Object.keys(require(resolvedPath)).length: {
        throw new Error(
          `No operations found. Expecting an exported object with atleast one key! PATH: ${resolvedPath}`
        );
      }
      case this.serviceInfo.hasOwnProperty(name): {
        throw new Error(`The microservice ${name} has already been defined.`);
      }
      default: {
        // Set options
        this.serviceOptions[name] = Object.assign({}, defaultServiceOptions, options);
        // Set information
        this.serviceInfo[name] = resolvedPath;
        // Return
        return true;
      }
    }
  }

  // FUNCTION: Initialise api gateway
  initGateway() {
    // Initial message
    this.log(`Micro Service Framework: ${version}`, 'log');
    // Return
    return new Promise((resolve, reject) =>
      isPortFree(this.settings.apiGatewayPort)
        .then(() => {
          this.log('Starting service core', 'log');
          // Initialise interface, invoke port listener
          this.externalInterfaces.apiGateway = this.invokeListener(this.settings.apiGatewayPort);
          // Check the status of the gateway
          return !this.externalInterfaces.apiGateway
            ? this.log('Unable to start gateway, exiting!', 'error') ||
                reject(Error('Unable to start gateway, exiting!'))
            : this.log('Service core started!', 'log') || resolve(true);
        })
        .catch(e => {
          this.log(`Gateway port not free or unknown error has occurred. INFO: ${JSON.stringify(e, null, 2)}`, 'log');
          return reject(
            Error(`Gateway port not free or unknown error has occurred. INFO: ${JSON.stringify(e, null, 2)}`)
          );
        })
    );
  }

  // FUNCTION: Bind api gateway event listners
  bindGateway() {
    return new Promise(resolve => {
      // Socket Communication Request
      this.externalInterfaces.apiGateway.on('COM_REQUEST', (message, data) => {
        // Confirm Connection
        this.log(`[${this.conId}] Service core connection request recieved`, 'log');
        // Process Communication Request
        data ? this.processComRequest(data, message, this.conId) : this.processComError(data, message, this.conId);
        // Process Connection
        this.log(`[${this.conId}] Service core connection request processed`);
        // Increment
        return this.conId++;
      });
      // Socket Communication Close
      this.externalInterfaces.apiGateway.on('COM_CLOSE', message => {
        // Connection Close Requested
        this.log(`[${this.conId}] Service core connection close requested`);
        // Destroy Socket (Close Connection)
        message.conn.destroy();
        // Connection Closed
        this.log(`[${this.conId}] Service core connection successfully closed`);
        // Increment
        return this.conId++;
      });
      // Socket Communication Kill Process
      this.externalInterfaces.apiGateway.on('KILL', () => {
        process.exit();
      });
      // Resolve promise
      return resolve();
    });
  }

  // FUNCTION: Start http instances
  startHttpServer() {
    // Return promise
    return Array.isArray(this.settings.http)
      ? Promise.all(
          this.settings.http.map(
            httpSettings =>
              new Promise((resolve, reject) => {
                try {
                  // Check if the HTTP server should be started or not
                  if (httpSettings) {
                    // Build express instance
                    const expressApp = express();
                    // Allow access to the express instance
                    httpSettings.beforeStart(expressApp);
                    // Assign static path resources if defined
                    httpSettings.static.forEach(path => expressApp.use(express.static(path)));
                    // Harden http server if hardening is defined
                    httpSettings.harden && this.hardenServer(expressApp);
                    // Apply middlewares to express
                    httpSettings.middlewares.forEach(middleware => expressApp.use(middleware));
                    // Assign routes
                    httpSettings.routes
                      .filter(route => {
                        if (['put', 'post', 'get', 'delete', 'patch'].includes(route.method.toLowerCase())) {
                          return true;
                        }
                        console.warn(`This route has an unknown method, skipping: ${JSON.stringify(route, null, 2)}`);
                        return false;
                      })
                      .forEach(route =>
                        expressApp[route.method.toLowerCase()](route.uri, (req, res, next) => {
                          setTimeout(() => {
                            try {
                              return route.handler(req, res, {
                                sendRequest: this.sendRequest,
                                CommandBodyObject,
                                ResponseBodyObject
                              });
                            } catch (e) {
                              console.log('I am here!');
                              return next(e);
                            }
                          }, 0);
                        })
                      );
                    // Start HTTP(s) server
                    if (typeof httpSettings.ssl === 'object') {
                      return (
                        this.httpsServer.push(
                          https.createServer(httpSettings.ssl, expressApp).listen(httpSettings.port)
                        ) && resolve()
                      );
                    }
                    return this.httpServer.push(http.createServer(expressApp).listen(httpSettings.port)) && resolve();
                  }
                  return resolve();
                } catch (e) {
                  return reject(Error(e));
                }
              })
          )
        )
      : new Promise(resolve => {
          this.log('No HTTP(s) servers defined. Starting services only...');
          return resolve();
        });
  }

  // FUNCTION: Harden HTTP server
  hardenServer(expressApp) {
    /*
      This hardening follows the guidance in this file:
      https://expressjs.com/en/advanced/best-practice-security.html
      This may be enhanced in the future
    */
    // Apply helmet
    return expressApp.use(helmet());
  }

  // FUNCTION: Bind api gateway event listners
  startServices(serviceInfo = void 0, customInstances = void 0) {
    // Variables
    const servicesInfo = serviceInfo || this.serviceInfo;
    // Return
    return new Promise((resolve, reject) => {
      if (Object.keys(servicesInfo)) {
        return Promise.all(
          shuffle(
            Object.keys(servicesInfo).reduce((acc, serviceName) => {
              // Instance count
              let instances = customInstances || this.serviceOptions[serviceName].instances;
              // Define process list
              const processList = [];
              // Build instances
              while (instances > 0) {
                // Push instance
                processList.push(serviceName);
                // Deincrement instances
                --instances;
              }
              // Return
              return acc.concat(...processList);
            }, [])
          ).map(
            name =>
              new Promise((resolveLocal, rejectLocal) =>
                this.initService(name, result =>
                  result === true
                    ? resolveLocal(true)
                    : rejectLocal(Error(`Unable to start microservice! MORE INFO: ${JSON.stringify(result, null, 2)}`))
                )
              )
          )
        )
          .then(() => resolve())
          .catch(e => reject(e));
      }
      return reject(Error('No microservices defined!'));
    });
  }
}

// Exports
export { CommandBodyObject, ResponseBodyObject };
