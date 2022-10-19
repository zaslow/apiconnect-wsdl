module.exports = {
  'env': {
    'browser': true,
    'commonjs': true,
    'es2021': true,
  },
  'extends': 'google',
  'overrides': [
  ],
  'parserOptions': {
    'ecmaVersion': 'latest',
  },
  'rules': {
    'guard-for-in': 'off',
    // 'max-len': ['error', {'code': 120}],
    'max-len': 'off',
    'require-jsdoc': 'off',
    'valid-jsdoc': 'off',
  },
};
