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
* Functions that occur after the swagger generation for the apiconnect-wsdl parser
**/

const u = require('../lib/utils.js');
const _ = require('lodash');
const dictionary = require('../lib/dictionary.js');
// var g = require('strong-globalize')();
const g = require('../lib/strong-globalize-fake.js');
const R = require('../lib/report.js');
const jsyaml = require('js-yaml');


/**
* Duplicate polymorphic hierarchy for each base definitions
*/
function duplicatePolyHierarchy(swagger, dict) {
  const req = dict.req;
  /**
     * If the root element is defined with a type.  Example:
     *  <xs:element name="Foo" type="s1:Base" />
     *
     * then definitions will be created for Foo and Base (Foo_s1 and Base_s1).
     *
     * If there are polymorphic extensions of Base (example Ext1 and Ext2)
     * then we need to duplicate these for Foo so that the assemply map policy works properly.
     * This function produces the duplicates (named Ext1_s1_for_Foo_s1 and Ext_s1_for_Foo_s1).
     *
     * Reproducing hierarchies could cause a large number of new definitions.  So
     * first see if we can do some optimizations.
     */

  let nsName; let def;

  // Create a potential map (element ns name-> type ns name) to see which element
  // definitions can be replaced with type definitions
  let potential = {};
  try {
    potential = optimizeRootElementsMap(swagger.definitions, dict);
  } catch (e) {
    R.error(req, g.http(u.r(req)).f('An unexpected error (%s) occurred while constructing the \'element optimization map\'. Processing continues.', e));
  }

  const subTypes = u.getSubTypes(swagger.definitions);

  // Create map (nsName -> subtype info) to assist in creation of duplicate hierarchies
  const map = {};
  try {
    if (swagger.definitions) {
      for (nsName in swagger.definitions) {
        def = swagger.definitions[nsName];
        // Get the original typeNS
        const typeNS = def['x-xsi-type-uniquename'];
        // Get all subtypes
        if (typeNS && typeNS != nsName) {
          map[nsName] = {};
          subTypeMap(map[nsName], subTypes, typeNS, nsName, nsName);
        }
      }
    }
  } catch (e) {
    R.error(req, g.http(u.r(req)).f('An unexpected error (%s) was encountered while constructing the \'subTypes map\'. Processing continues.', e.stack));
  }

  // Determine how many duplicate definitions will be created for elements
  // if we don't optimize elements
  let forElements = 0;
  for (const e in potential) {
    if (map[e]) {
      forElements += Object.keys(map[e]).length;
      const anc = u.getAncestorRefs(swagger.definitions, e, req);
      if (anc) {
        forElements += anc.length;
      }
    }
  }

  // If the number of duplicate definitions for elements is sufficiently
  // large then replace the elements with their type.
  if (forElements > 75) {
    replaceRefs(swagger, potential);
    for (const defName in potential) {
      delete swagger.definitions[defName];
    }
  }

  // Now do the hierarchy duplication
  let count = 0;
  if (swagger.definitions) {
    for (nsName in swagger.definitions) {
      def = swagger.definitions[nsName];
      if (map[nsName]) {
        // Clone the descendent hierarchy of the nsName
        for (const subType in map[nsName]) {
          const newNSName = map[nsName][subType].name;
          const forElement = dict.dictEntry[subType] && dict.dictEntry[subType].for === 'element';
          if (!forElement &&
                        !swagger.definitions[newNSName] &&
                         swagger.definitions[subType]) {
            // Create the new nsName using the subtype
            swagger.definitions[newNSName] = u.deepClone(swagger.definitions[subType]);
            // ..but the highest level xml is same as the original nsName
            swagger.definitions[newNSName].xml = u.deepClone(def.xml);
            count++;
            // If there is an allOf, change it to the new base
            if (swagger.definitions[newNSName]['allOf'] && swagger.definitions[newNSName]['allOf'][0]['$ref']) {
              swagger.definitions[newNSName].allOf[0]['$ref'] = '#/definitions/' + map[nsName][subType].base;
            }
            swagger.definitions[newNSName]['x-xsi-type-uniquename'] = newNSName;
          }
        }
        // Clone the ancestor hierarchy of the nsName
        const anc = u.getAncestorRefs(swagger.definitions, nsName, req);
        if (anc && anc.length > 0) {
          for (let i = 0; i < anc.length; i++) {
            const ancNSName = u.getDefNameFromRef(anc[i]);
            const newAncNSName = ancNSName + '_for_' + nsName;
            if (!swagger.definitions[newAncNSName] &&
                             swagger.definitions[ancNSName]) {
              // Create the clone
              swagger.definitions[newAncNSName] = u.deepClone(swagger.definitions[ancNSName]);
              // ..but the highest level xml is same as the original nsName
              swagger.definitions[newAncNSName].xml = u.deepClone(def.xml);
              count++;
              // Change the reference to the next ancestor
              if (i < anc.length - 1 &&
                                swagger.definitions[newAncNSName]['allOf'] &&
                                swagger.definitions[newAncNSName]['allOf'][0]['$ref']) {
                swagger.definitions[newAncNSName].allOf[0]['$ref'] += '_for_' + nsName;
              }
              if (swagger.definitions[newAncNSName]['x-xsi-type-uniquename']) {
                swagger.definitions[newAncNSName]['x-xsi-type-uniquename'] += '_for_' + nsName;
              }
            }
          }
          if (def['allOf'] && def['allOf'][0]['$ref']) {
            def.allOf[0]['$ref'] += '_for_' + nsName;
          }
        }
      }
    }
  }
}

function optimizeRootElementsMap(definitions, dict) {
  const potential = [];

  if (definitions) {
    const map = u.findRefs(definitions);

    for (const nsName in definitions) {
      // If pattern is <xs:element name="Foo" type="s1:Bar" />
      const dictEntry = dict.dictEntry[nsName];
      if (dictEntry &&
                dictEntry.for == 'element' &&
                dictEntry.typeNSName) {
        const refTypeNSName = dictEntry.typeNSName;
        const rDictEntry = dict.dictEntry[refTypeNSName];
        let defTypeNSName; let dDictEntry;
        if (rDictEntry && rDictEntry.schemaType === 'typeOf') {
          defTypeNSName = rDictEntry.typeNSName;
          dDictEntry = dictEntry[defTypeNSName];
        }

        // Ensure that both the element and type definitions exist and they have same qualification
        if (!dictEntry.preventOptimize &&
                    rDictEntry && dDictEntry &&
                    definitions[refTypeNSName] &&
                    definitions[refTypeNSName].xml &&
                    definitions[refTypeNSName].xml &&
                    definitions[nsName].xml.namespace == definitions[refTypeNSName].xml.namespace) {
          // Only attempt optimization if the type is in a polymorphic hierarchy
          const anc = u.getAncestorRefs(definitions, nsName, dict.req);
          if (u.inPolyHierarchy(definitions, nsName, anc, map)) {
            potential[nsName] = refTypeNSName;
          }
        }
      }
    }
  }
  return potential;
}

function subTypeMap(map, subTypes, base, newBase, root) {
  if (subTypes[base]) {
    const subTypeList = subTypes[base];
    for (let i = 0; i < subTypeList.length; i++) {
      const subType = subTypeList[i];
      map[subType] = {};
      map[subType].base = newBase;
      map[subType].name = subType + '_for_' + root;
      subTypeMap(map, subTypes, subType, map[subType].name, root);
    }
  }
}

/**
* Replaces $refs with the new name from the map
*/
function replaceRefs(swagger, map) {
  return u.traverse(swagger, function(curr, path) {
    const key = path.length > 0 ? path[path.length - 1] : undefined;
    const key2 = path.length > 1 ? path[path.length - 2] : undefined;
    const key3 = path.length > 2 ? path[path.length - 3] : undefined;
    if (curr && (key === '$ref' || key3 === 'discriminator' && key2 === 'mapping')) {
      const words = curr.split('/');
      const nsName = words[words.length - 1];
      if (map[nsName]) {
        curr = '#/definitions/' + map[nsName];
      }
    }
    return curr;
  });
}

function inlineReferences(xso, swagger) {
  return u.traverse(xso, function(curr) {
    // This is a prefix function
    // Detect a $ref, and replace with the full definition
    if (curr && curr.$ref) {
      const nsName = u.getDefNameFromRef(curr.$ref);
      delete curr.$ref;
      u.extendObject(curr, swagger.definitions[nsName], true);
    }
    return curr;
  });
}

/**
* Cleanup definitions (remove unnecessary fields)
*/
function cleanupDefinitions(swagger, req) {
  // Don't rename the typedef definitions if they appear in a V3 polymorphism.
  const doNotRename = {};
  const defs = swagger.definitions || swagger.components.schemas;
  for (const nsName in defs) {
    const xso = defs[nsName];
    if (xso.discriminator && xso.oneOf) {
      for (let i = 0; i < xso.oneOf.length; i++) {
        const refNSName = u.getDefNameFromRef(xso.oneOf[i].$ref);
        doNotRename[refNSName] = true;
      }
    }
  }

  // Replace/rename each typedef
  const map = {};
  u.traverseSchemaObjects(swagger, function(xso, nsName, context) {
    delete xso['x-anc-ref'];
    delete xso['x-desc-ref'];

    // Convert each unique name to use type (to match legacy mapping)
    if (xso['x-xsi-type-uniquename']) {
      xso['x-xsi-type-uniquename'] = _.replace(xso['x-xsi-type-uniquename'], '_typedef_', '_' + 'type' + '_');
    }
    if (nsName.includes('_typedef_') && context.isRoot) {
      if (!doNotRename[nsName]) {
        const typeRef = _.replace(nsName, '_typedef_', '_' + 'type' + '_');

        if (swagger.definitions[typeRef] && canReplace(swagger, typeRef, nsName)) {
          map[nsName] = typeRef; // replace typedef with typeref
        } else if (!swagger.definitions[typeRef]) {
          map[nsName] = typeRef; // rename to typeRef
        }
      }
    }
    return xso;
  });

  for (const r in map) {
    if (swagger.definitions[map[r]]) {
      delete swagger.definitions[r];
    } else {
      swagger.definitions[map[r]] = swagger.definitions[r];
      delete swagger.definitions[r];
    }
  }
  replaceRefs(swagger, map);

  /*
    let text = jsyaml.safeDump(swagger);
    text = _.replace(text, /_typedef_/g, '_type_');
    text = _.replace(text, /_typebase_/g, '_type_');
    swagger = jsyaml.safeLoad(text);
    */
  return swagger;
}
function canReplace(swagger, target, source) {
  if (!swagger.definitions[target]) {
    return false;
  }
  const targetNullable = swagger.definitions[target]['x-nullable'] || swagger.definitions[target]['nullable'];
  const sourceNullable = swagger.definitions[source]['x-nullable'] || swagger.definitions[source]['nullable'];
  if (targetNullable != sourceNullable) {
    return false;
  }
  // Can't replace if the type is a V3 discriminator
  return !swagger.definitions[target].discriminator;
}

/**
 * Replace $ref for attributes with inlined definitions
 * and remove the attribute definitions
 */
function inlineSwaggerAttributes(swagger) {
  const attrMap = {};

  // Find all of the nsNames for the attributes
  for (const nsName in swagger.definitions) {
    const def = swagger.definitions[nsName];
    if (def.xml && def.xml.attribute) {
      attrMap['#/definitions/' + nsName] = nsName;
    }
  }

  // Replace the $refs
  if (Object.keys(attrMap).length > 0) {
    u.traverseSchemaObjects(swagger, function(xso) {
      if (xso.$ref) {
        const attrNSName = attrMap[xso.$ref];
        if (attrNSName) {
          delete xso.$ref;
          u.extendObject(xso, swagger.definitions[attrNSName], true);
        }
      }
      return xso;
    });
  }

  // Remove the attr definitions
  for (const ref in attrMap) {
    delete swagger.definitions[attrMap[ref]];
  }

  return swagger;
}

/**
* Walk the definitions and look for x-ibm-complex-restriction
* and replace the base ref with all of the base attributes.
* (According to the schema specification, the particles of
* the xsd:restriction do not need to include attributes, the
* attributes are obtained from the descendent classes)
*/
function processComplexContentRestriction(swagger) {
  let found = false;
  u.traverseSchemaObjects(swagger, function(xso) {
    if (xso['x-ibm-complex-restriction']) {
      found = true;
      processXSOwithXICR(xso, swagger.definitions);
    }
    return xso;
  });
  if (found) {
    // If processed complex content, do another squash allOf pass.
    squashAllOfs(swagger);
  }
}

/**
* The obj has a x-ibm-complex-restriction.
* Its first allOf is the ref to the base type.
* This first allOf is replaced with the attributes of the base (and descendent) types
* The second allOf contains the properties built from contents of the xsd:restriction.
*/
function processXSOwithXICR(obj, definitions) {
  delete obj['x-ibm-complex-restriction'];
  let baseNSName; let propsAttrs; let propsRestriction;
  if (obj.allOf && obj.allOf.length > 1 && obj.allOf[0].$ref) {
    // Get the base NSName and then replace the first allOf with
    // an empty property xso.  We will put the attributes in
    // the first allOf.
    baseNSName = u.getDefNameFromRef(obj.allOf[0].$ref);
    obj.allOf[0] = {
      xml: u.deepClone(obj.allOf[1].xml),
      type: 'object',
      properties: {},
    };

    propsAttrs = obj.allOf[0].properties;
    propsRestriction = obj.allOf[1].properties || {};
  }
  while (baseNSName) {
    const baseXSO = definitions[baseNSName];
    baseNSName = null;
    if (baseXSO) {
      // Copy attributes to propsAttrs
      if (baseXSO.properties) {
        for (const key in baseXSO.properties) {
          if (!propsRestriction[key]) {
            const xso = baseXSO.properties[key];
            if (xso.xml && xso.xml.attribute) {
              propsAttrs[key] = u.deepClone(xso);
            }
          }
        }
      }
      if (baseXSO.allOf) {
        for (let i = 0; i < baseXSO.allOf.length; i++) {
          if (baseXSO.allOf[i].$ref) {
            // Repeat with new base
            baseNSName = u.getDefNameFromRef(baseXSO.allOf[i].$ref);
          } else if (baseXSO.allOf[i].properties) {
            const props = baseXSO.allOf[i].properties;
            for (const key in props) {
              if (!propsRestriction[key]) {
                const xso = props[key];
                if (xso.xml && xso.xml.attribute) {
                  propsAttrs[key] = u.deepClone(xso);
                }
              }
            }
          }
        }
      }
    }
    // Remove prohibited attributes
    for (const key in propsRestriction) {
      if (propsRestriction[key]['x-prohibited']) {
        delete propsRestriction[key];
      }
    }
  }
}


/**
* All of the defaults and enums are string values, and need to be converted
* to boolean or number as necessary.
*/
function adjustDefaults(swagger) {
  u.traverseSchemaObjects(swagger, function(xso) {
    if (xso.default || xso.enum) {
      if (xso.type) {
        // Type is at the same level

        // The specification indicates that the default value
        // must be of the same type as the type
        if (xso.default) {
          xso.default = convertTo(xso.type, xso.default);
        }

        // The specification is silent on whether the enum
        // values must be the same as the type, but it makes
        // sense if the default must match the type.
        if (xso.enum) {
          for (let i = 0; i < xso.enum.length; i++) {
            xso.enum[i] = convertTo(xso.type, xso.enum[i]);
          }
        }
      } else {
        // This is more complicated.
        // Inline all of the refs, find the type, and then
        // move the default and enum to the same xso as the type.
        xso = inlineReferences(xso, swagger);
        const pxso = getPrimitiveXSO(xso);
        if (pxso) {
          if (xso.default) {
            pxso.default = convertTo(pxso.type, xso.default);
          }
          if (xso.enum) {
            pxso.enum = [];
            for (let i = 0; i < xso.enum.length; i++) {
              pxso.push(convertTo(pxso.type, xso.enum[i]));
            }
          }
        }
        delete xso.default;
        delete xso.enum;
      }
    }
    return xso;
  });
}

function getPrimitiveXSO(xso) {
  if (!xso) {
    return null;
  }
  if (xso.type) {
    if (xso.type == 'array') {
      return getPrimitiveXSO(xso.items);
    } else if (xso.type === 'object') {
      return null;
    } else {
      return xso;
    }
  } else {
    if (xso.anyOf || xso.oneOf || xso.allOf) {
      let s = xso.anyOf || xso.oneOf || xso.allOf;
      for (let i = 0; i < s.length; s++) {
        const pxso = getPrimitiveXSO(s[i]);
        if (pxso) {
          return pxso;
        }
      }
    }
  }
  return null; // Give up
}

/**
* Convert value to the indicated type
*/
function convertTo(type, value) {
  let newValue = value;
  // If boolean, adjust the value if necessary
  if (type === 'boolean') {
    if (typeof newValue === 'string') {
      newValue = u.parseToPrimitive(value);
    }
    if (newValue == 1) {
      newValue = true;
    } else if (newValue == 0) {
      newValue = false;
    }
  }
  if (type === 'number' || type === 'integer') {
    if (typeof newValue === 'string') {
      newValue = Number(value);
    }
  }
  return newValue;
}

/**
 * Remove unreferenced definitions
 */
function removeUnreferencedDefinitions(swagger, keepRootElements) {
  const keep = {};

  // Pre-populate keep map
  const map = u.findRefs(swagger.paths);

  for (const nsName in swagger.definitions) {
    const def = swagger.definitions[nsName];
    if (nsName === 'Security') {
      keep[nsName] = {};
    } else if (nsName.endsWith('_Header')) { // Extra Implicit Header added by schema
      keep[nsName] = {};
    } else if (map.refs['#/definitions/' + nsName]) {
      keep[nsName] = {};
    } else if (keepRootElements && def.xml && def.xml.name) {
      keep[nsName] = {};
    }
  }

  // Walk the keep map and add new references
  let repeat = true;
  while (repeat) {
    repeat = false;
    for (const nsName in keep) {
      if (!keep[nsName].traversed) {
        repeat = true;
        keep[nsName].traversed = true;
        const def = swagger.definitions[nsName];
        if (!def) {
          continue;
        }

        // Find the references within this definition
        const map = u.findRefs(def);

        // Walk the references and add them to the keep map
        for (const ref in map.refs) {
          const nsName2 = u.getDefNameFromRef(ref);
          const def2 = swagger.definitions[nsName2];
          const refObj = map.refs[ref];
          if ((refObj.count - refObj.allOfCount) > 0) {
            // strong reference
            keep[nsName2] = keep[nsName2] || {};
            if (!def2) {
              continue;
            }

            // Add the definitions that extend this definition (for polymorphism)
            if (def2['x-ibm-discriminator'] && !keep[nsName2].calcPoly) {
              keep[nsName2].calcPoly = true;
              const extList = getExtensions(ref, swagger);
              for (let i = 0; i < extList.length; i++) {
                keep[extList[i]] = keep[extList[i]] || {};
                keep[extList[i]].calcPoly = true;
              }
            }
          } else {
            // only allOf reference
            keep[nsName2] = keep[nsName2] || {};
          }
        }
      }
    }
  }

  for (const nsName in swagger.definitions) {
    if (!keep[nsName]) {
      delete swagger.definitions[nsName];
    }
  }
}

function getExtensions(baseRef, swagger, list) {
  list = list || [];
  for (const nsName in swagger.definitions) {
    const def = swagger.definitions[nsName];
    if (def.allOf && def.allOf.length > 0 && def.allOf[0].$ref === baseRef) {
      list.push(nsName);
      if (def['x-ibm-discriminator']) {
        list = list.concat(getExtensions('#/definitions/' + nsName, swagger, []));
      }
    }
  }
  return list;
}

/**
* @return map popluated with refs, nullableRefs and nonNullableRefs
*/
function findRefsAndNullables(swagger) {
  const map = {
    refs: {},
    nullableRefs: {},
    nonNullableRefs: {},
  };
  u.traverseSchemaObjects(swagger, function(xso, ncName, context, path) {
    const isAllOf = path.length > 2 && path[path.length - 2] === 'allOf';
    if (xso.$ref) {
      const ref = xso.$ref;
      map.refs[ref] = map.refs[ref] || {count: 0, allOfCount: 0};
      map.refs[ref].count += 1;
      if (isAllOf) {
        map.refs[ref].allOfCount += 1;
      } else {
        const defName = u.getDefNameFromRef(ref);
        if (xso['x-nullable']) {
          if (!map.nullableRefs[defName]) {
            map.nullableRefs[defName] = [];
          }
          map.nullableRefs[defName].push(xso);
          delete xso['x-nullable'];
        } else {
          map.nonNullableRefs[defName] = true;
        }
      }
    }
    return xso;
  });
  return map;
}

/**
* Detect if nillable=true and nillable=false is needed for the same type.
* In such cases, the definition is duplicated and the refs are corrected.
*/
function fixupForNilAndNonNil(swagger, createOptions) {
  const req = createOptions.req;

  // The map returned will identify which references are nullable
  // and which references are non-nullable.
  const map = findRefsAndNullables(swagger);

  // If type, Base, is referenced as non-nullable,
  // but its extension, Ext, is referenced as nullable, then both need to be cloned.
  const subTypes = u.getSubTypes(swagger.definitions);
  let updatedMap = false;
  do {
    updatedMap = false;
    for (const nullableDef in map.nullableRefs) {
      if (subTypes[nullableDef]) {
        for (let i = 0; i < subTypes[nullableDef].length; i++) {
          const subType = subTypes[nullableDef][i];
          if (!map.nullableRefs[subType]) {
            map.nullableRefs[subType] = [];
            updatedMap = true;
          }
        }
      }
      const anc = u.getAncestorRefs(swagger.definitions, nullableDef, req);
      if (anc) {
        for (let j = 0; j < anc.length; j++) {
          const ancNSName = u.getDefNameFromRef(anc[j]);
          if (!map.nullableRefs[ancNSName]) {
            map.nullableRefs[ancNSName] = [];
            updatedMap = true;
          }
        }
      }
    }
    for (const nonNullableDef in map.nonNullableRefs) {
      if (subTypes[nonNullableDef]) {
        for (let i = 0; i < subTypes[nonNullableDef].length; i++) {
          const subType = subTypes[nonNullableDef][i];
          if (!map.nonNullableRefs[subType]) {
            map.nonNullableRefs[subType] = [];
            updatedMap = true;
          }
        }
      }
      const anc = u.getAncestorRefs(swagger.definitions, nonNullableDef, req);
      if (anc) {
        for (let j = 0; j < anc.length; j++) {
          const ancNSName = u.getDefNameFromRef(anc[j]);
          if (!map.nonNullableRefs[ancNSName]) {
            map.nonNullableRefs[ancNSName] = [];
            updatedMap = true;
          }
        }
      }
    }
  } while (updatedMap);

  for (const nullableDefName in map.nullableRefs) {
    if (map.nonNullableRefs[nullableDefName]) {
      // Adjust the refs before cloning
      const nullableDefNameName = nullableDefName + '_nil';
      const clonedRef = '#/definitions/' + nullableDefNameName;
      const nullProps = map.nullableRefs[nullableDefName];
      for (let ad = 0; ad < nullProps.length; ad++) {
        const nullProp = nullProps[ad];
        nullProp['$ref'] = clonedRef;
      } // end for
    }
  }
  for (const nullableDefName in map.nullableRefs) {
    if (map.nonNullableRefs[nullableDefName]) {
      // Now clone the nullable definition
      const clonedNSName = nullableDefName + '_nil';
      const clonedDef = u.deepClone(swagger.definitions[nullableDefName]);
      const anc = u.getAncestorRefs(swagger.definitions, nullableDefName, req);
      // If extending a base, adjust the ref
      if (anc && anc.length > 0 &&
                clonedDef.allOf &&
                clonedDef.allOf.length > 1 &&
                clonedDef.allOf[0].$ref) {
        clonedDef.allOf[0].$ref += '_nil';
      }
      if (clonedDef['x-xsi-type-uniquename']) {
        clonedDef['x-xsi-type-uniquename'] += '_nil';
      } else {
        clonedDef['x-xsi-type-uniquename'] = clonedNSName;
      }
      clonedDef['x-nullable'] = true;
      if (swagger.definitions[nullableDefName]['x-nullable']) {
        delete swagger.definitions[nullableDefName]['x-nullable'];
      }
      swagger.definitions[clonedNSName] = clonedDef;
    } else {
      swagger.definitions[nullableDefName]['x-nullable'] = true;
    }
  }
}

/**
* For each xml schema object (xso), add/remove the xml namespace according to the specification.
* This is done for clarity and to avoid unnecessary
* (and sometimes confusing) processing when trying to determine the namespace
* and prefix of an object.
* @param swagger
* @return updated swagger
*/
function c14nXMLObjects(swagger, pure) {
  return u.traverseSchemaObjects(swagger, function(xso, nsName, context, path) {
    // Postfix function ... remove unecessary xml objects
    // The prefix function adds all of the descendent xml objects, so now it is safe to remove the unncessary objects.
    // If pure is set, then remove xml objects that are not roots or underneath properties or items
    // Also remove xso if there is an items key
    if (pure) {
      const key = path.length > 0 ? path[path.length - 1] : undefined;
      const key2 = path.length > 1 ? path[path.length - 2] : undefined;
      if (xso.xml) {
        if (context.isRoot || key2 === 'properties' || key === 'items') {
          // This xml can be discarded if there are any items and is not a name
          if (xso.items && !xso.xml.name) {
            delete xso.xml;
          }
        } else {
          // Not a root, property or array item
          delete xso.xml;
        }
      }
    }
    return xso;
  }, function(xso, nsName, context, path, stack) {
    // Prefix ... add xml objects
    // The algorithm is slightly different for arrays versus non-arrays
    if (!xso.items) {
      if (!xso.$ref && !xso.xml) {
        // For non-arrays
        // Look up the stack until xml is found
        for (let i = stack.length - 1; i >= 0; i--) {
          const obj = stack[i];
          if (obj.xml) {
            xso.xml = {
              namespace: obj.xml.namespace,
              prefix: obj.xml.prefix,
            };
            return xso;
          }
        }
      }
    }
    // If there is an xso, make sure it has a namespace.
    // I believe this is required by the map runtime.
    // The V2->V3 converter appears to remove the namespace if set to ''.
    if (xso.xml) {
      if (xso.xml.namespace == null) {
        xso.xml.namespace = '';
      }
    }
    return xso;
  });
}

function removeRedundantPrefixes(swagger) {
  return u.traverseSchemaObjects(swagger, function(xso, nsName, context) {
    if (xso.xml && xso.xml.prefix === '' && xso.xml.namespace === '' &&
            !xso.properties &&
             xso.type && xso.type !== 'object' && xso.type !== 'array') {
      delete xso.xml.prefix;
    }
    return xso;
  });
}

/**
* A typeOf is added during generate processing to indicate:
*   - a) indicate a root element is a typeOf a root type (ie. myElement_element_s1 typeOf myType_type_s1)
*   - b) indicate a root attribute is a typeOf a root type (ie. myAttr_attribute_s1 typeOf myType_type_s1)
*   - c) indicate that a type for a different referencing context is a typeOf a root type. (ie. myType_type_s1_unqual typeOf myType_type_s1)
*   - d) a definition for a message part (i.e. myPart_tns typeOf myType_type_s1).
*   - e) in rare situations it is used to locate a substitutionGroup element (i.e.e myElement_element_s1 typeOf myElement2_element_s1)
*
* The algorithm of the map runtime currently does not have a way to process this sort of
* indirection; therefore the typeOf information is applied to the referencing xso.
**/
function expandTypeOfs(swagger, dict, req) {
  u.traverseSchemaObjects(swagger, function(xso, nsName) {
    if (xso.typeOf) {
      const isPartUsage = xso.forPart;
      delete xso.forPart;

      // Get the xso for the typeOf
      let anc = xso['x-anc-ref'];
      let desc = xso['x-desc-ref'];
      let typeDefRef = xso.typeOf.$ref;
      let typeXSO = getRef(swagger, typeDefRef, req);
      anc = anc || typeXSO['x-anc-ref'];
      desc = desc || typeXSO['x-desc-ref'];
      while (typeXSO.typeOf) {
        typeDefRef = typeXSO.typeOf.$ref;
        typeXSO = getRef(swagger, typeXSO.typeOf.$ref, req);
        anc = anc || typeXSO['x-anc-ref'];
        desc = desc || typeXSO['x-desc-ref'];
      }

      // Get the typeOf NSName and dictionary entry
      const ref = xso.typeOf.$ref;
      const lastSlash = ref.lastIndexOf('/');
      const typeNSName = ref.substr(lastSlash + 1);
      const typeDictEntry = dict.dictEntry[typeNSName];

      // Get the dictEntry for the target xso
      const dictEntry = dict.dictEntry[nsName];

      // Copy the typeOf xso into the target xso (except for the xml, example, and poly refs)
      const newXSO = u.deepClone(typeXSO);
      if (xso.xml) {
        newXSO.xml = xso.xml;
      }
      if (xso.example) {
        newXSO.example = xso.example;
      }
      if (xso['x-anc-ref']) {
        newXSO['x-anc-ref'] = xso['x-anc-ref'];
      }
      if (xso['x-desc-ref']) {
        newXSO['x-desc-ref'] = xso['x-desc-ref'];
      }

      xso = newXSO;
      if (!xso.xml.attribute) {
        delete xso.xml.attribute;
      }

      // Adjust the ancestor ref
      if (xso['x-anc-ref'] && xso.allOf[0].$ref) {
        xso.allOf[0].$ref = xso['x-anc-ref'].$ref;
      }

      // The XSI type information is not needed in some cases.
      if (xso.xml.attribute ||
                isPartUsage ||
                dictEntry && dictEntry.suppressXSIType) {
        delete xso['x-ibm-discriminator'];
        delete xso['x-xsi-type'];
        delete xso['x-xsi-type-xml'];
        delete xso['x-xsi-type-uniquename'];
        delete xso['x-xsi-type-abstract'];
      }
      if (xso['x-xsi-type-uniquename'] && typeDictEntry && typeDictEntry.for === 'typedef') {
        xso['x-xsi-type-uniquename'] = nsName;
      }

      // Use oneOf format if V3
      if (dict.createOptions.v3discriminator && xso['x-ibm-discriminator']) {
        delete xso.oneOf;
        delete xso.allOf;
        delete xso.anyOf;
        delete xso.properties;
        delete xso.type;
        delete xso['x-anc-ref'];
        delete xso['x-desc-ref'];
        xso.oneOf = [];
        xso.oneOf.push({$ref: typeDefRef});
        if (desc) {
          xso.oneOf = xso.oneOf.concat(desc);
        }
        xso.discriminator = {
          propertyName: 'x-ibm-discriminator',
          mapping: {},
        };

        // Create the mappings
        for (let i = 0; i < xso.oneOf.length; i++) {
          const pXSO = getRef(swagger, xso.oneOf[i].$ref, req);
          // Get the xsi:type in the form {ns}local for the xso
          const xsiType = u.getXSIType(pXSO, swagger.definitions, true);
          if (xsiType !== 'NONE') {
            if (i === 0) {
              // If not set then use the base type
              xso.discriminator.mapping[''] = xso.oneOf[i].$ref;
            }
            xso.discriminator.mapping[xsiType] = xso.oneOf[i].$ref;
            if (xsiType.lastIndexOf('}') >= 0) {
              xso.discriminator.mapping[xsiType.substring(xsiType.lastIndexOf('}') + 1)] = xso.oneOf[i].$ref;
            }
            xso.discriminator.mapping[xso.oneOf[i].$ref] = xso.oneOf[i].$ref;
            xso.discriminator.mapping[xso.oneOf[i].$ref.substring(xso.oneOf[i].$ref.lastIndexOf('/') + 1)] = xso.oneOf[i].$ref;
          }
        }
      }
    }
    return xso;
  });
  // If v3 discriminator, all of the discriminator files have been added.
  // Remove the x-ibm-discriminator from typedefs
  if (dict.createOptions.v3discriminator) {
    for (const nsName in swagger.definitions) {
      const xso = swagger.definitions[nsName];
      delete xso['x-ibm-discriminator'];
    }
  }
}

function squashAllOfs(swagger) {
  u.traverseSchemaObjects(swagger, function(xso) {
    return u.squashAllOf(xso);
  });
}

function removeAnyOfs(swagger, req) {
  u.traverseSchemaObjects(swagger, function(xso) {
    if (xso.anyOf) {
      for (let i = 0; i < xso.anyOf.length; i++) {
        if (xso.anyOf[i].$ref) {
          const dxso = getDef(swagger, xso.anyOf[i], req);
          delete xso.anyOf[i].$ref;
          u.extendObject(xso.anyOf[i], dxso, true);
        }
      }
      if (xso.anyOf.length === 0) {
        delete xso.anyOf;
      } else {
        // Create an xso (s) that is a combination of each of the anyOf xsos (t)
        const s = {
          type: xso.anyOf[0].type,
          enum: xso.anyOf[0].enum ? u.deepClone(xso.anyOf[0].enum) : undefined,
        };
        if (xso.anyOf[0].format) {
          s.format = xso.anyOf[0].format;
        }
        for (let i = 1; i < xso.anyOf.length; i++) {
          const t = xso.anyOf[i];
          // If the type or format differ, then fallback to string
          if (s.type !== t.type || s.format !== t.format) {
            s.type = 'string';
            delete s.format;
            delete s.enum;
          }
          if (s.enum && !t.enum) {
            delete s.enum;
          }
          if (s.enum && t.enum) {
            s.enum = _.union(s.enum, t.enum);
          }
        }
        const target = xso;
        const source = s;
        delete xso.anyOf;
        xso = _.merge(target, source);
      }
    }
    return xso;
  });
}

function removeOneOfs(swagger) {
  u.traverseSchemaObjects(swagger, function(xso) {
    if (xso.oneOf) {
      xso.allOf = xso.oneOf;
      delete xso.oneOf;
      removeRequired(xso.allOf);
    }
    return xso;
  });
}

/**
* A sequence, all, choice or group with a occurence will be mapped
* as an array under a construct that does not have a name.
*     [allOf,oneOf,items]:
*         type: array
*         minItems..
*         maxItems..
*         items:
*            allOf...
* The minItem/maxItem information is squashed into the contents of the inner allOf
*/
function removeUnnamedOccurrence(swagger, req) {
  return u.traverseSchemaObjects(swagger, function(xso) {
    if (xso.allOf || xso.oneOf) {
      const a = xso.allOf || xso.oneOf;
      for (let i = 0; i < a.length; i++) {
        const innerXSO = a[i];
        if (!innerXSO) {
          console.log(xso);
        }
        if (innerXSO.type === 'array' && innerXSO.items &&
                   (innerXSO.items.allOf || innerXSO.items.oneOf)) {
          const minItems = innerXSO.minItems || 0;
          const maxItems = innerXSO.maxItems || 'unbounded';
          const xibmgroup = innerXSO['x-ibm-group'];
          a[i] = propogateOccurrence(minItems, maxItems, xibmgroup, innerXSO.items, swagger, req);
        }
      }
    }
    return xso;
  });
}

function propogateOccurrence(minItems, maxItems, xibmgroup, xso, swagger, req) {
  if (xso.$ref) {
    xso = u.deepClone(getDef(swagger, xso, req));
  }
  if (xso.oneOf || xso.allOf) {
    const list = xso.oneOf || xso.allOf;
    for (let i = 0; i < list.length; i++) {
      let xso2 = list[i];
      // If a reference, process the definition of the reference
      if (xso2.$ref) {
        xso2 = u.deepClone(getDef(swagger, xso2, req));
      }
      list[i] = propogateOccurrence(minItems, maxItems, xibmgroup, xso2, swagger, req);
    }
  }
  if (xso.type == 'array') {
    if (xso.minItems) {
      if (minItems !== 'unbounded') {
        xso.minItems *= minItems;
      }
    }
    if (xso.maxItems) {
      if (maxItems === 'unbounded') {
        delete xso.maxItems;
      } else {
        xso.maxItems *= maxItems;
      }
    }
    if (xso.minItems === 0) {
      delete xso.minItems;
    }
    if (xso.maxItems === 'unbounded') {
      delete xso.maxItems;
    }
    if (maxItems != 1) {
      if (xso['x-ibm-group']) {
        xso['x-ibm-group'] = _.concat(xibmgroup, xso['x-ibm-group']);
      } else {
        xso['x-ibm-group'] = xibmgroup;
      }
    }
  } else if (xso.properties) {
    for (const key in xso.properties) {
      const propXSO = xso.properties[key];
      let propMinItems = minItems;
      // Adjust minItems to zero if this property is not required
      if (!xso.required || xso.required.indexOf(key) < 0) {
        propMinItems = 0;
      }
      const propMaxItems = maxItems;
      if (propXSO.type === 'array') {
        propogateOccurrence(propMinItems, propMaxItems, xibmgroup, propXSO, swagger, req);
      } else {
        if (propMaxItems != 1) {
          xso.properties[key] = {
            'type': 'array',
            'items': u.deepClone(propXSO),
            'x-ibm-group': u.deepClone(xibmgroup),
          };
          if (propMinItems == 0) {
            delete xso.properties[key].minItems;
          } else if (propMinItems !== 'unbounded') {
            xso.properties[key].minItems = propMinItems;
          }
          if (propMaxItems !== 'unbounded') {
            xso.properties[key].maxItems = propMaxItems;
          } else {
            delete xso.properties[key].maxItems;
          }
          const dxso = getDef(swagger, propXSO, req);
          if (dxso.xml) {
            xso.properties[key].xml = u.deepClone(dxso.xml);
          }
        }
      }
    }
    if (minItems === 0) {
      delete xso.required;
    }
  }
  return xso;
}

/**
* @return the definition, automatically processes $ref
*/
function getDef(swagger, obj, req) {
  if (obj['$ref']) {
    return getRef(swagger, obj['$ref'], req);
  }
  return obj;
}

/**
* @return the referenced definitions
*/
function getRef(swagger, ref, req) {
  const keys = ref.split('/');
  let def = swagger;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== '#') {
      def = def[keys[i]];
      if (!def) {
        throw g.http(u.r(req)).Error('The reference %s does not exist.', ref);
      }
    }
  }
  return def;
}

/**
* Removal the required elements from an allOf list.
* Used for choice processing.
*/
function removeRequired(allOfList) {
  for (let i = 0; i < allOfList.length; i++) {
    const allOf = allOfList[i];
    if (allOf.properties) {
      for (const propName in allOf.properties) {
        const prop = allOf.properties[propName];
        if (prop.minItems) {
          delete prop.minItems;
        }
      }
      delete allOf.required;
    }
    if (allOf.allOf) {
      removeRequired(allOf.allOf);
    }
  }
}

const XSOKEYS = [
  'not',
  '$ref',
  'xml',
  'description',
  'type',
  'format',
  'default',
  'enum',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'pattern',
  'minLength',
  'maxLength',
  'items',
  'properties',
  'allOf',
  'oneOf',
  'anyOf',
  'additionalProperties',
  'required',
  'nullable',
  'x-nullable',
  'x-ibm-whiteSpace',
  'x-ibm-fractionDigits',
  'x-ibm-totalDigits',
  'discriminator',
  'x-ibm-discriminator',
  'x-xsi-type',
  'x-xsi-type-xml',
  'x-xsi-type-abstract',
  'x-xsi-type-uniquename',
  'x-ibm-group',
  'x-anyType',
  'x-ibm-complex-restriction',
  'x-ibm-schema',
  'x-ibm-messages',
  'example',
];
const XSOTEMPKEYS = [
  'x-ibm-basic-choice',
];
const XMLKEYS = [
  'namespace',
  'prefix',
  'name',
  'attribute',
];

function c14nxso(swagger, req, v3nullable) {
  return u.traverseSchemaObjects(swagger, function(xso) {
    xso = c14nObject(xso, XSOKEYS);
    if (v3nullable != null) {
      if (v3nullable && xso['x-nullable'] != null) {
        xso['nullable'] = xso['x-nullable'];
        delete xso['x-nullable'];
      } else if (!v3nullable && xso['nullable'] != null) {
        xso['x-nullable'] = xso['nullable'];
        delete xso['nullable'];
      }
    }
    if (xso.xml) {
      xso.xml = c14nObject(xso.xml, XMLKEYS, req);
    }
    if (xso['x-xsi-type-xml']) {
      xso['x-xsi-type-xml'] = c14nObject(xso['x-xsi-type-xml'], XMLKEYS, req);
    }
    // Remove unnecessary empty properties object
    if (xso.type !== 'object' && xso.properties && Object.keys(xso.properties).length === 0) {
      delete xso.properties;
    }
    return xso;
  });
}

function c14nObject(source, c14nList, req) {
  const target = {};
  const copyList = [];
  const len = c14nList.length;
  for (let i = 0; i < len; i++) {
    const key = c14nList[i];
    if (key in source) {
      const value = source[key];
      if (value !== null && (typeof value !== 'undefined')) {
        target[key] = value;
      }
      copyList.push(key);
    }
  }
  const moreKeys = _.difference(Object.keys(source), copyList);
  if (moreKeys.length) {
    const keys = moreKeys.sort();
    for (let i = 0; i < keys.length; i++) {
      // Don't persist temporary keys
      if (XSOTEMPKEYS.indexOf(keys[i]) < 0) {
        const value = source[keys[i]];
        if (value !== null && (typeof value !== 'undefined')) {
          target[keys[i]] = value;
        }
      }
    }
  }
  return target;
}

function sortDefinitions(swagger) {
  return u.traverseSwagger(swagger, function(swagger) {
    if (swagger.definitions) {
      const keys = Object.keys(swagger.definitions).sort();
      const target = {};
      for (let i = 0; i < keys.length; i++) {
        target[keys[i]] = swagger.definitions[keys[i]];
      }
      swagger.definitions = target;
    }
    if (swagger.components && swagger.components.schemas) {
      const keys = Object.keys(swagger.components.schemas).sort();
      const target = {};
      for (let i = 0; i < keys.length; i++) {
        target[keys[i]] = swagger.components.schemas[keys[i]];
      }
      swagger.components.schemas = target;
    }
    return swagger;
  });
}

exports.c14nXMLObjects = c14nXMLObjects;
exports.adjustDefaults = adjustDefaults;
exports.cleanupDefinitions = cleanupDefinitions;
exports.c14nxso = c14nxso;
exports.duplicatePolyHierarchy = duplicatePolyHierarchy;
exports.expandTypeOfs = expandTypeOfs;
exports.fixupForNilAndNonNil = fixupForNilAndNonNil;
exports.inlineSwaggerAttributes = inlineSwaggerAttributes;
exports.processComplexContentRestriction = processComplexContentRestriction;
exports.removeRedundantPrefixes = removeRedundantPrefixes;
exports.removeUnreferencedDefinitions = removeUnreferencedDefinitions;
exports.sortDefinitions = sortDefinitions;
exports.squashAllOfs = squashAllOfs;
exports.removeAnyOfs = removeAnyOfs;
exports.removeOneOfs = removeOneOfs;
exports.removeUnnamedOccurrence = removeUnnamedOccurrence;
