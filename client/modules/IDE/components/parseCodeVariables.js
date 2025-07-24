/* eslint-disable */
import { debounce } from 'lodash';
import * as eslintScope from 'eslint-scope';
import classMap from './class-with-methods-map.json';

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const allFuncs = require('./listOfAllFunctions.json');
const allFunsList = new Set(allFuncs.functions.list);

const functionToClass = {};
Object.entries(classMap).forEach(([className, classData]) => {
  const createMethods = classData.createMethods || [];
  createMethods.forEach((fnName) => {
    functionToClass[fnName] = className;
  });
});

// Cache to store last valid result
let lastValidResult = {
  p5ClassMap: {},
  varScopeMap: {},
  userFuncMap: {},
  userClassMap: {}
};

function _parseCodeVariables(_cm) {
  const code = _cm.getValue();
  let ast;

  try {
    ast = parser.parse(code, {
      sourceType: 'script',
      plugins: ['jsx', 'classProperties'],
      ranges: true,
      locations: true
    });
  } catch (e) {
    return lastValidResult;
  }

  const p5ClassMap = {};
  const varScopeMap = {};
  const userFuncMap = {};
  const userClassMap = {};

  const scopeManager = eslintScope.analyze(ast, {
    ecmaVersion: 2020,
    sourceType: 'script'
  });

  scopeManager.scopes.forEach((scope) => {
    const scopeName =
      scope.type === 'function'
        ? scope.block.id?.name || '<anonymous>'
        : scope.type;

    scope.variables.forEach((variable) => {
      variable.defs.forEach((def) => {
        if (
          def.type === 'Variable' ||
          (def.type === 'FunctionName' && !allFunsList.has(def.name.name))
        ) {
          if (!varScopeMap[scopeName]) {
            varScopeMap[scopeName] = new Set();
          }

          varScopeMap[scopeName].add(def.name.name);
        }
      });
    });
  });

  traverse(ast, {
    ClassDeclaration(path) {
      const node = path.node;
      if (node.id && node.id.type === 'Identifier') {
        const className = node.id.name;
        const classInfo = {
          const: new Set(),
          methods: []
        };

        node.body.body.forEach((element) => {
          if (element.type === 'ClassMethod') {
            const methodName = element.key.name;

            if (element.kind === 'constructor') {
              element.body.body.forEach((stmt) => {
                if (
                  stmt.type === 'ExpressionStatement' &&
                  stmt.expression.type === 'AssignmentExpression'
                ) {
                  const expr = stmt.expression;
                  if (
                    expr.left.type === 'MemberExpression' &&
                    expr.left.object.type === 'ThisExpression' &&
                    expr.left.property.type === 'Identifier'
                  ) {
                    const propName = expr.left.property.name;
                    classInfo.const.add(propName);
                  }
                }
              });
            } else {
              classInfo.methods.push(methodName);
            }
          }
        });

        userClassMap[className] = {
          const: Array.from(classInfo.const),
          methods: classInfo.methods,
          initializer: ''
        };
      }
    },

    AssignmentExpression(path) {
      const node = path.node;
      if (
        node.left.type === 'Identifier' &&
        (node.right.type === 'CallExpression' ||
          node.right.type === 'NewExpression') &&
        node.right.callee.type === 'Identifier'
      ) {
        const varName = node.left.name;
        const fnName = node.right.callee.name;

        const cls = functionToClass[fnName];
        const userCls = userClassMap[fnName];
        if (userCls) {
          userClassMap[fnName].initializer = varName;
        } else if (cls) {
          p5ClassMap[varName] = cls;
        }
      }
    },

    VariableDeclarator(path) {
      const node = path.node;
      if (
        node.id.type === 'Identifier' &&
        (node.init?.type === 'CallExpression' ||
          node.init?.type === 'NewExpression') &&
        node.init.callee.type === 'Identifier'
      ) {
        const varName = node.id.name;
        const fnName = node.init.callee.name;
        const cls = functionToClass[fnName];
        const userCls = userClassMap[fnName];
        if (userCls) {
          userClassMap[fnName].initializer = varName;
        } else if (cls) {
          p5ClassMap[varName] = cls;
        }
      }
    },

    FunctionDeclaration(path) {
      const node = path.node;
      if (node.id && node.id.name) {
        const fnName = node.id.name;
        if (!allFunsList.has(fnName)) {
          const params = node.params
            .map((param) => {
              if (param.type === 'Identifier') {
                return { p: param.name, o: false };
              } else if (
                param.type === 'AssignmentPattern' &&
                param.left.type === 'Identifier'
              ) {
                return { p: param.left.name, o: true };
              } else if (
                param.type === 'RestElement' &&
                param.argument.type === 'Identifier'
              ) {
                return { p: param.argument.name, o: true };
              }
              return null;
            })
            .filter(Boolean);

          // Store function metadata for hinting
          userFuncMap[fnName] = {
            text: fnName,
            type: 'fun',
            p5: false,
            params
          };

          // Store function params in the varScopeMap
          if (!varScopeMap[fnName]) {
            varScopeMap[fnName] = new Set();
          }
          params.forEach((paramObj) => {
            if (paramObj && paramObj.p) {
              varScopeMap[fnName].add(paramObj.p);
            }
          });
        }
      }
    }
  });

  const result = {
    p5ClassMap,
    varScopeMap,
    userFuncMap,
    userClassMap
  };

  lastValidResult = result;
  return result;
}

// Export a debounced version
export default debounce(_parseCodeVariables, 200, {
  leading: true,
  trailing: true,
  maxWait: 300
});
