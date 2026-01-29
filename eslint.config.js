import { icebreaker } from '@icebreakers/eslint-config'

export default icebreaker(
  {
    ignores: ['**/fixtures/**'],
    rules: {
      'dot-notation': 'off',
    },
  },
)
