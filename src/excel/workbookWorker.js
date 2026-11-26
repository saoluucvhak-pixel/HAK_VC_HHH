'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { decodeXlsx } = require('./workbookReader');

decodeXlsx(Buffer.from(workerData.buffer, workerData.byteOffset, workerData.byteLength))
  .then((sheets) => parentPort.postMessage({ sheets }))
  .catch((error) => parentPort.postMessage({ error: error.message }));
