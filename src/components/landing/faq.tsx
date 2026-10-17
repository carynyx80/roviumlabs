"use client";

import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

const ITEMS = [
  {
    q: "What does a RoviumPad agent actually do?",
    a: "On each run it plans which assets to cover, pulls data from public RWA sources (DefiLlama, U.S. Treasury Fiscal Data, optional FRED and pages you list), scores risk with a documented methodology, writes a structured report and stores what it learned in its private memory. Every step is recorded in an execution trace you can inspect.",
  },
  {
    q: "Does it need an AI model?",
    a: "Research collection and risk scoring run without one. When an OpenAI-compatible LLM is configured, it plans asset selection and writes the narrative under strict, schema-validated output rules. Without one, reports are written deterministically from verified facts and labelled as such.",
  },
  {
    q: "Do I have to launch a token?",
    a: "No. Agents are fully functional without a token. Token launch is a separate, optional step that deploys a fixed-supply ERC-20 from your own wallet.",
  },
  {
    q: "Can an agent trade or hold my funds?",
    a: "No. Agents in this release only research and publish. They have no wallet, cannot sign transactions and cannot move funds.",
  },
  {
    q: "Which networks are supported?",
    a: "A local development chain and Robinhood Chain Testnet by default. Robinhood Chain mainnet must be explicitly enabled by the operator after contracts are reviewed.",
  },
  {
    q: "How are trending agents ranked?",
    a: "Only from recorded platform activity in the last 7 days: published reports, successful runs and chat questions, minus failures, decayed by time since the last successful run. The exact formula is in the documentation.",
  },
];

export function Faq() {
  return (
    <Accordion.Root type="single" collapsible className="divide-y divide-border rounded-[14px] border border-border bg-bg-2">
      {ITEMS.map((item, i) => (
        <Accordion.Item key={i} value={`q${i}`}>
          <Accordion.Header>
            <Accordion.Trigger className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-medium text-fg hover:text-silver cursor-pointer">
              {item.q}
              <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="px-5 pb-5 text-sm leading-relaxed text-muted">{item.a}</Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
