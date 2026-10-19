#!/usr/bin/env node
/**
 * @hux_xl/bounty-triage — MCP stdio server
 *
 * Judges a bounty/task description against NZ1Labs' proven 5-criteria
 * triage policy (evolved through 40+ real submissions on Taskmarket/Reef,
 * refs/reef/head f21be04). Returns TAKE or SKIP with reason and confidence.
 *
 * Design goal: stop agents from burning compute on lottery bounties
 * (206-submission coin flips, $0.15 slots, broken verifiers).
 *
 * Protocol: MCP over stdio (JSON-RPC 2.0, one message per line).
 * Tools:    bounty_triage_judge, bounty_triage_policy
 */

import readline from 'node:readline';

const SERVER_NAME = 'nz1labs-bounty-triage';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'bounty_triage_judge',
    description:
      "Judges a bounty/task description against NZ1Labs' proven 5-criteria triage policy (evolved through 40+ real submissions across Taskmarket/Reef). Returns TAKE or SKIP with reason and confidence. Designed to prevent agents from wasting cycles on lottery bounties.",
    inputSchema: {
      type: 'object',
      properties: {
        bounty_description: {
          type: 'string',
          description: 'The full text of the bounty or task to judge.',
        },
        hourly_equivalent_usd: {
          type: 'number',
          description:
            'Estimated effective hourly rate for this task (optional; required if reward/subs suggests low EV).',
        },
        submission_count: {
          type: 'integer',
          description: 'Current number of submissions on this bounty.',
        },
        our_credentials_complete: {
          type: 'boolean',
          description:
            'True if we have all required credentials/API keys for this bounty.',
        },
        verifier_known_defective: {
          type: 'boolean',
          description:
            'True if the verifier/grader is known-broken or absent.',
        },
      },
      required: ['bounty_description'],
    },
  },
  {
    name: 'bounty_triage_policy',
    description:
      'Returns the full 5-criteria triage policy as structured JSON for agents to introspect.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const POLICY = {
  name: 'nz1labs-bounty-triage',
  version: '1.0.0',
  evolved_via: 'Reef loop refs/reef/head f21be04',
  criteria: [
    {
      id: 'C1',
      rule: 'missing-credentials',
      verdict: 'SKIP',
      reason:
        'Required API keys or account access are absent; no path to completion.',
    },
    {
      id: 'C2',
      rule: 'defective-verifier',
      verdict: 'SKIP+flag',
      flag_threshold: 20,
      reason:
        'Grader is absent or known-broken; work would be judged unfairly. Flag to operator after 20 occurrences.',
    },
    {
      id: 'C3',
      rule: 'lottery-saturation',
      verdict: 'SKIP',
      threshold: 100,
      reason:
        '>= 100 submissions means payout probability is too low to be worth the effort.',
    },
    {
      id: 'C4',
      rule: 'low-EV',
      verdict: 'SKIP',
      threshold_usd_per_hour: 15,
      reason: 'Effective hourly rate below $15/hr after time cost.',
    },
    {
      id: 'C5',
      rule: 'default',
      verdict: 'TAKE',
      reason: 'None of the SKIP criteria met — take the bounty.',
    },
  ],
  order: ['C1', 'C2', 'C3', 'C4', 'C5'],
};

function judge(
  bounty_description,
  hourly_equivalent_usd = null,
  submission_count = null,
  our_credentials_complete = true,
  verifier_known_defective = false
) {
  const bd = String(bounty_description ?? '').toLowerCase();

  // C1: missing credentials
  const cred_patterns = [
    'api key', 'api-key', 'apikey', 'signup required', 'register an account',
    'email address', 'x-api-key', 'bearer token', 'oauth',
  ];
  const needs_creds = cred_patterns.some((p) => bd.includes(p));
  if (needs_creds && !our_credentials_complete) {
    return {
      verdict: 'SKIP',
      criterion: 'C1',
      reason:
        'missing-credentials: bounty requires credentials we do not hold',
    };
  }

  // C2: defective verifier
  if (verifier_known_defective) {
    return {
      verdict: 'SKIP',
      criterion: 'C2',
      reason:
        'defective-verifier: grader is broken or absent; flag to operator',
    };
  }

  // C3: lottery saturation
  if (
    submission_count !== null &&
    Number.isInteger(submission_count) &&
    submission_count >= 100
  ) {
    return {
      verdict: 'SKIP',
      criterion: 'C3',
      reason: `lottery-saturation: ${submission_count} submissions exceeds 100 threshold — payout probability too low`,
    };
  }

  // C4: low effective hourly rate
  if (
    typeof hourly_equivalent_usd === 'number' &&
    Number.isFinite(hourly_equivalent_usd) &&
    hourly_equivalent_usd < 15
  ) {
    return {
      verdict: 'SKIP',
      criterion: 'C4',
      reason: `low-EV: effective hourly rate $${hourly_equivalent_usd.toFixed(2)} below $15 threshold`,
    };
  }

  // C5: default TAKE
  return {
    verdict: 'TAKE',
    criterion: 'C5',
    reason: 'all SKIP criteria clear — take the bounty',
  };
}

function handle_rpc(body) {
  const method = body.method ?? '';
  const id = body.id;
  const params = body.params ?? {};

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }
  if (method === 'tools/call') {
    const name = params.name ?? '';
    const args = params.arguments ?? {};
    if (name === 'bounty_triage_judge') {
      const result = judge(
        args.bounty_description,
        args.hourly_equivalent_usd ?? null,
        args.submission_count ?? null,
        args.our_credentials_complete ?? true,
        args.verifier_known_defective ?? false
      );
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      };
    }
    if (name === 'bounty_triage_policy') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(POLICY, null, 2) }],
          isError: false,
        },
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `unknown tool: ${name}` },
    };
  }
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `unknown method: ${method}` },
  };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const raw = line.trim();
  if (!raw) return;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'parse error' },
      }) + '\n'
    );
    return;
  }
  const resp = handle_rpc(body);
  if (resp !== null) process.stdout.write(JSON.stringify(resp) + '\n');
});

process.stderr.write(
  `[${SERVER_NAME}] v${SERVER_VERSION} — MCP stdio server ready\n`
);
