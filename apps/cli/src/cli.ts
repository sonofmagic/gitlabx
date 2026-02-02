#!/usr/bin/env node
import { handleCliError } from './error-handler'
import { runCli } from './index'

runCli().catch(handleCliError)
