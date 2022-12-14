# API Connect WSDL

## Getting Started
To get up and running, just add a require:

```javascript
const apicWsdl = require("apiconnect-wsdl");
```

## Test

Simply run npm install.  This will run 200+ tests and 1000+ asserts:
```javascript
  npm install
```
More complicated testing is described in the [general docs](docs/HOME.md)

## Links

 - Build and Release information is located in the [release docs](docs/RELEASE.md) 

 - A private cli (wpcli) is available to execute functions. See  [general docs](docs/HOME.md)

 - If you have questions about WSDL, SOAP, generation see the [support docs](docs/SUPPORT.md) and the [matrix](docs/DETAILS.md)

 - The primary apis are listed below.  Older apis are located in [legacy apis](docs/OLDAPIS.md)

## Primary Apis

### create

```javascript
/**
* Create an openapi from wsdl
* @param {Buffer or String file location or String url} wsdl or zip content
* @param {String} serviceName name of the wsdl service
* @param {String} wsdlId id to use in the generated swagger.  Often this is the filename
* @param options
*     type: 'wsdl' (default) or 'wsdl-to-rest'
*     openapiVersion: '2.0' (default) or '3.0'
*     wssecurity: true (default) or false
*     gateway: datapower-gateway (default) or datapower-api-gateway or micro-gateway
*     req: request or null (used for i18n negotiation and error collection)
*     allowExtraFiles: false (default) or true
*     level: messages to report: DETAIL, INFO (default), WARNING, ERROR
*     analysis: perform analysis of created openapi (default false)
*     defaults: object to merge into openapi after generation.  Same shape as openapi
*     auth: auth object if wsdl is protected url
*     jsonStyle: condensed (default) or badgerfish
*     port: (optional) port name.  If not specified, first soap port is used.
*     mapOptions: setting to use for autogenerated assembly map. The default is
*      {
*           includeEmptyXMLElements: false,
*           inlineNamespaces: false,
*           mapEnablePostProcessingJSON: true,
*           mapResolveXMLInputDataType: true,
*           mapResolveApicVariables: false
*      }
*     mapSOAPFaults: true (if wsdl-to-rest) or false.  Catch block for SOAPFaults
* @return {
*              openapi: <openapi>
*              analysis: {  analysis messages }
*         }
 */
function createOpenApi(wsdl, serviceName, wsdlId, options)
```
Creates an openapi from a wsdl.
  - The wsdl can be a Buffer containing the wsdl/zip contents or a url/filepath.
  - The serviceName is the name of the service within the wsdl for this created api.
  - The openapiversion is 2.0 or the new 3.0 version
  - The type is 'wsdl' (for wsdl proxy) or 'wsdl-to-rest' (SOAP->REST)
  - The create api has its own defaults for various fields.  You can provide your own overrides.

```javascript
  let result = await.apicWsdl.create(buffer, serviceName, filename,
	 {
     type: 'wsdl',
     openapiVersion: version,
     defaults: {
       securityDefinitions: {
         clientIdHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'X-IBM-Client-Id',
         }
       },
       security: [ {
         clientIdHeader: []
       } ],
       'x-ibm-configuration': {
          cors: {
            enabled: false
          },
       }
     }
	 });
  // The openapi is within result.openapi

```

### validateWSDL

```javascript
/**
* Validates wsdl and rejects with error containing messages.
* @error { "message": <combined message>
*          messages[ {message: <message>}* ]
*        }
* @param locationOrContent location of WSDL or Buffer
* @param options auth and other options.
* @returns promise of serviceData
*/
function validateWSDL(locationOrContent, options);
```
The validateWSDL method will parse the wsdl/zip and perform some additional semantic validation of the wsdl.  Thrown errors list the individual messages

```javascript
  try {
    await.apicWsdl.validateWSDL(buffer);
	catch (err) {
		// Process messages
	}
```

### validateXSD

```javascript
/**
* Validates xsd and rejects with error containing messages.
* @error { "message": <combined message>
*          messages[ {message: <message>}* ]
*        }
* @param locationOrContent location of XSD or Buffer
* @param options auth and other options.
* @returns promise of serviceData
*/
function validateXSD(locationOrContent, options);
```
The validateWSDL method will parse the xsd/zip and perform some additional semantic validation of the xsd.  Thrown errors list the individual messages

```javascript
  try {
    await.apicWsdl.validateXSD(buffer);
	catch (err) {
		// Process messages
	}
```

### introspectWSDL

```javascript
/**
* Introspect wsdl and rejects with error containing messages.
* @error { "message": <combined message>
*          messages[ {message: <message>}* ]
*        }
* @param locationOrContent location of WSDL or Buffer
* @param options auth and other options.
* @returns promise of serviceData
*/
function introspectWSDL(locationOrContent, options)...
```
The introspectWSDL api is used to determine which services are in the
wsdl.

```javascript
Example Response
{ portTypes:
   { MyPortTypeType:
      [ { name: 'getStuff', description: undefined },
        { name: 'doStuff', description: undefined } ] },
  bindings:
   { MySOAPBinding:
      { type: 'MyPortType',
        operations: [ 'getStuff', 'doStuff' ] } },
  services:
   [ { service: 'MyService',
       filename: 'MyWSDL_1.0.0.wsdl',
       operations:
        [ { operation: 'getStuff' },
          { operation: 'doStuff' } ] } ] }
```

```javascript
  try {
    let serviceData = await.apicWsdl.introspectWSDL(buffer);
	catch (err) {
		// Process serviceData
	}
```

### addTargetOpenApi

```javascript
//**
* addTargetOpenApi
* @param openApi - existing openApi
* @param wsdl - Buffer containing the wsdl/zip or location of the wsdl/zip
* @param wsdlServiceName - Service
* @return promise openApi
*/
function addTargetOpenApi(openapi, wsdl, wsdlServiceName) ..
```
The addTargetOpenApi api is used to add a target service into an existing openapi.
  - The openapi is the existing openapi (version 2.0 or 3.0)
	- The wsdl is a Buffer, wsdl/zip file location or URL
	- The wsdl service is the name of the target service in the wsdl
	- returns an openapi with the embedded target service.


```javascript
    let updated_openapi = await.apicWsdl.addTargetOpenApi(openapi, wsdl, service);
```

### addXSDToTargetOpenApi

```javascript
/**
* addXSDToTargetOpenApi
* @param openApi - existing openApi
* @param xsd - Buffer containing the xsd or location of the xsd
* @param wsdlServiceName - Service
* @return promise openApi
*/
function addTargetOpenApi(openapi, xsd, wsdlServiceName) ..
```
The addXSDToTargetOpenApi api is used to add xsd definitions to a target service within an existing openapi.
  - The openapi is the existing openapi (version 2.0 or 3.0)
	- The xsd is a Buffer, xsd/zip file location or URL
	- The wsdl service is the name of the target service in the wsdl
	- returns an openapi with the embedded target service.


```javascript
    let updated_openapi = await.apicWsdl.addXSDToTargetOpenApi(openapi, xsd, service);
```

### injectServiceEndpointsIntoWSDLorZIP
```javascript
/**
* @param inContent wsdl or zip content (Buffer or String)
* @param serviceEndpoints single or array of endpoint strings
* @param serviceName the wsdl-definition.service string.
* @return (Promise)
*   outContent: wsdl or zip content in a Buffer
*   filename: if zip mode, this is the full name of first wsdl modified within the zip
*   stringContent: in zip mode, this is the string content of filename.
*                  in wsdl mode, this is the string content of the wsdl file
*/
function injectServiceEndpointsIntoWSDLorZIP(inContent, serviceEndpoints, serviceName)..
```
Use this method to add endpoints into a wsdl/zip file stored on apim.
This is used dynamically in the portal when a wsdl is requested.
