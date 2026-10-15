import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.maestri/**', 'art-source/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@tabler/icons',
          message: 'Não importe o pacote de SVG cru. Use @tabler/icons-react com importação nomeada.',
        }],
        patterns: [{
          group: ['@tabler/icons-react'],
          importNames: ['*'],
          message: 'Importe os ícones por nome (ex.: import { IconShoppingBag } from "@tabler/icons-react"), nunca com import *.',
        }],
      }],
    },
  },
  {
    files: ['src/routes/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true, allowExportNames: ['loader', 'clientLoader'] }],
    },
  },
)
