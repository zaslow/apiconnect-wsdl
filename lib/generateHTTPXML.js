/** ******************************************************* {COPYRIGHT-TOP} ***
 * Licensed Materials - Property of IBM
 * 5725-Z22, 5725-Z63, 5725-U33, 5725-Z63
 *
 * (C) Copyright IBM Corporation 2016, 2020
 *
 * All Rights Reserved.
 * US Government Users Restricted Rights - Use, duplication or disclosure
 * restricted by GSA ADP Schedule Contract with IBM Corp.
 ********************************************************** {COPYRIGHT-END} **/

'use strict';

/**
* Functions that generate an HTTP XML api
**/

const u = require('../lib/utils.js');
const _ = require('lodash');
const dictionary = require('../lib/dictionary.js');
const genDefs = require('../lib/generateDefs.js');
// var g = require('strong-globalize')();
const g = require('../lib/strong-globalize-fake.js');
const R = require('../lib/report.js');

/**
* Generate HTTP XML sections of the api.
* @param serviceName name of the service for this apic
* @param globalNamespaces the global namespace map defining unique prefixes for each namespace
* @param serviceJSON
* @param dict is the Dictionary
* @param refMap is the referenced definition map
* @param options create options
* @return swagger
*/
function generateHTTPXML(serviceName, globalNamespaces, serviceJSON, dict, refMap, options) {
  const req = dict.req;

  // If multiple services of the same name were detected,
  // then the serviceName was changed to disambiguate the services
  // <serviceName>-from-<slugifiedpath>
  const originalServiceName = serviceName;
  let title = originalServiceName;
  const mangleIndex = originalServiceName.indexOf('-from-');
  if (mangleIndex > 0) {
    serviceName = originalServiceName.substring(0, mangleIndex);
  }
  // If the port was explicitly specified, then add it to the title to disambiguate from
  // services that use the default port.
  if (options.port) {
    title += ' using port ' + options.port;
  }
  const url = serviceJSON.service[0].undefined.endpoint;

  // Create the initial swagger
  const swagger = initializeSwagger(serviceName, title, 'rest', options.gateway, url);
  return swagger;
}

/**
* Generate the initial swagger
*/
function initializeSwagger(serviceName, title, type, gateway, url) {
  let ibmName = u.slugifyName(title);
  // Truncate ibm name and title to reasonable length.
  // They may be used (with a version) to produce a product or other name.
  // The product (and other names) must be less than 256 chars in the portal.
  ibmName = ibmName.substring(0, 240);
  title = title.substring(0, 240);

  const swagger = {
    'swagger': '2.0',
    'info': {
      'title': title,
      'description': '',
      'x-ibm-name': ibmName,
      'version': '1.0.0',
    },
    'schemes': ['https'],
    'basePath': '/',
    'produces': ['application/xml'],
    'consumes': ['text/xml'],
    'securityDefinitions': {
      clientID: {
        type: 'apiKey',
        name: 'X-IBM-Client-Id',
        in: 'header',
        description: '',
      },
    },
    'security': [{
      clientID: [],
    }],
    'x-ibm-configuration': {
      type: type,
      phase: 'realized',
      enforced: true,
      testable: true,
      gateway: 'datapower-gateway', // Assume datapower-gateway, will modify later
      cors: {
        enabled: true,
      },
      assembly: {
        execute: [],
      },
    },
    'paths': {},
    'definitions': {},
  };
  swagger['x-ibm-configuration'].assembly.execute[0] = {
    proxy: {
      'title': 'proxy',
      'target-url': url,
    },
  };
  return swagger;
}
exports.generateHTTPXML = generateHTTPXML;
