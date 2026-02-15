// A2A Protocol Agent Cards — https://a2a-protocol.org/latest/specification/
// Each Swarm agent declares its capabilities in standard A2A Agent Card format

export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  protocolVersion: string;
  provider: {
    organization: string;
    url: string;
  };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    multiRoundDiscussion: boolean;
    scoreRevision: boolean;
  };
  skills: {
    id: string;
    name: string;
    description: string;
    inputModes: string[];
    outputModes: string[];
  }[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

export const AGENT_CARDS: Record<string, A2AAgentCard> = {
  security: {
    name: 'Security Sentinel',
    description: 'Blockchain security analyst specializing in smart contract audits, rug-pull detection, honeypot identification, and exploit pattern recognition.',
    url: `${BASE_URL}/api/agents/security`,
    version: '1.0.0',
    protocolVersion: '0.3',
    provider: {
      organization: 'Swarm Intelligence Protocol',
      url: BASE_URL,
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      multiRoundDiscussion: true,
      scoreRevision: true,
    },
    skills: [
      {
        id: 'contract-audit',
        name: 'Smart Contract Security Audit',
        description: 'Analyze contract ownership, minting functions, honeypot indicators, liquidity locks, and known exploit patterns.',
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'rug-pull-detection',
        name: 'Rug-Pull Risk Assessment',
        description: 'Evaluate probability of rug-pull based on contract code, ownership patterns, and historical data.',
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
  },

  technical: {
    name: 'Technical Analyst',
    description: 'Blockchain technical analyst specializing in on-chain metrics, tokenomics evaluation, holder distribution analysis, and smart contract quality assessment.',
    url: `${BASE_URL}/api/agents/technical`,
    version: '1.0.0',
    protocolVersion: '0.3',
    provider: {
      organization: 'Swarm Intelligence Protocol',
      url: BASE_URL,
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      multiRoundDiscussion: true,
      scoreRevision: true,
    },
    skills: [
      {
        id: 'tokenomics-analysis',
        name: 'Tokenomics Evaluation',
        description: 'Analyze token supply distribution, holder concentration, vesting schedules, and inflation mechanics.',
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'onchain-metrics',
        name: 'On-Chain Metrics Analysis',
        description: 'Evaluate transaction volume trends, active addresses, and network activity patterns.',
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
  },

  social: {
    name: 'Social Scout',
    description: 'Crypto social sentiment analyst specializing in community metrics, social media engagement tracking, developer activity monitoring, and KOL influence assessment.',
    url: `${BASE_URL}/api/agents/social`,
    version: '1.0.0',
    protocolVersion: '0.3',
    provider: {
      organization: 'Swarm Intelligence Protocol',
      url: BASE_URL,
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      multiRoundDiscussion: true,
      scoreRevision: true,
    },
    skills: [
      {
        id: 'sentiment-analysis',
        name: 'Social Sentiment Analysis',
        description: 'Analyze community size, growth trajectory, social media engagement, and overall market sentiment.',
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'kol-tracking',
        name: 'KOL & Influencer Tracking',
        description: 'Monitor influencer mentions, developer activity, and community leadership quality.',
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
  },

  whale: {
    name: 'Whale Tracker',
    description: 'Whale movement tracker specializing in large holder behavior analysis, smart money flow detection, accumulation/distribution pattern recognition.',
    url: `${BASE_URL}/api/agents/whale`,
    version: '1.0.0',
    protocolVersion: '0.3',
    provider: {
      organization: 'Swarm Intelligence Protocol',
      url: BASE_URL,
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      multiRoundDiscussion: true,
      scoreRevision: true,
    },
    skills: [
      {
        id: 'whale-tracking',
        name: 'Whale Activity Monitor',
        description: 'Track large wallet accumulation/distribution patterns, whale concentration, and recent large transactions.',
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'smart-money',
        name: 'Smart Money Flow Analysis',
        description: 'Identify smart money movements, early investor behavior, and institutional flow patterns.',
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
  },

  momentum: {
    name: 'Momentum Beacon',
    description: 'Market momentum analyst specializing in price action patterns, volume analysis, RSI conditions, and breakout identification.',
    url: `${BASE_URL}/api/agents/momentum`,
    version: '1.0.0',
    protocolVersion: '0.3',
    provider: {
      organization: 'Swarm Intelligence Protocol',
      url: BASE_URL,
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      multiRoundDiscussion: true,
      scoreRevision: true,
    },
    skills: [
      {
        id: 'momentum-analysis',
        name: 'Price Momentum Analysis',
        description: 'Evaluate price trend direction, volume momentum, overbought/oversold conditions, and breakout patterns.',
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
  },

  liquidity: {
    name: 'Liquidity Oracle',
    description: 'DeFi liquidity analyst specializing in pool depth evaluation, liquidity lock verification, LP distribution analysis, and slippage assessment.',
    url: `${BASE_URL}/api/agents/liquidity`,
    version: '1.0.0',
    protocolVersion: '0.3',
    provider: {
      organization: 'Swarm Intelligence Protocol',
      url: BASE_URL,
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      multiRoundDiscussion: true,
      scoreRevision: true,
    },
    skills: [
      {
        id: 'liquidity-analysis',
        name: 'Liquidity Health Assessment',
        description: 'Analyze DEX pool depth, lock status, LP token distribution, and slippage characteristics.',
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
  },

  narrative: {
    name: 'Narrative Navigator',
    description: 'Crypto narrative analyst specializing in market trend alignment, value proposition evaluation, competitive positioning, and trend timing assessment.',
    url: `${BASE_URL}/api/agents/narrative`,
    version: '1.0.0',
    protocolVersion: '0.3',
    provider: {
      organization: 'Swarm Intelligence Protocol',
      url: BASE_URL,
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      multiRoundDiscussion: true,
      scoreRevision: true,
    },
    skills: [
      {
        id: 'narrative-analysis',
        name: 'Narrative Strength Assessment',
        description: 'Evaluate alignment with current market narratives, unique value proposition, and trend timing.',
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
  },

  contract: {
    name: 'Contract Auditor',
    description: 'Smart contract code analyst specializing in DeFi protocol security, proxy pattern detection, upgrade mechanism evaluation, and fee structure analysis.',
    url: `${BASE_URL}/api/agents/contract`,
    version: '1.0.0',
    protocolVersion: '0.3',
    provider: {
      organization: 'Swarm Intelligence Protocol',
      url: BASE_URL,
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      multiRoundDiscussion: true,
      scoreRevision: true,
    },
    skills: [
      {
        id: 'code-audit',
        name: 'Contract Code Quality Audit',
        description: 'Analyze verification status, proxy patterns, upgrade mechanisms, admin functions, and fee structures.',
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
  },
};

// Leader agent card — the orchestrator
export const LEADER_CARD: A2AAgentCard = {
  name: 'Swarm Leader',
  description: 'Orchestration agent that coordinates multi-agent analysis through A2A protocol. Manages team assembly, discussion rounds, score revision, and weighted consensus.',
  url: `${BASE_URL}/api/swarm`,
  version: '1.0.0',
  protocolVersion: '0.3',
  provider: {
    organization: 'Swarm Intelligence Protocol',
    url: BASE_URL,
  },
  capabilities: {
    streaming: true,
    pushNotifications: false,
    multiRoundDiscussion: true,
    scoreRevision: true,
  },
  skills: [
    {
      id: 'swarm-analyze',
      name: 'Swarm Consensus Analysis',
      description: 'Orchestrate 4-agent team through independent analysis, 2-round cross-agent discussion, score revision, and weighted consensus.',
      inputModes: ['application/json'],
      outputModes: ['text/event-stream'],
    },
  ],
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['text/event-stream'],
};
