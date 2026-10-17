"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, Card, CardContent, CardHeader, CardTitle, Skeleton, Stat } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

export function UsagePanel({ agentId }: { agentId: string }) {
  const q = useQuery({
    queryKey: ["usage", agentId],
    queryFn: () => api<{ days: { day: string; research: number; chat: number; costUsd: number }[]; today: number; dailyBudget: number; spentTodayUsd: number; dailySpendLimitUsd: number; models: string[] }>(`/api/agents/${agentId}/usage`),
  });
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const d = q.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI usage</CardTitle>
        <p className="text-[13px] text-muted">Tokens reported by the LLM provider for research and public chat (14 days).</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Spend today (est.)" value={"$" + d.spentTodayUsd.toFixed(4)} hint={"Limit $" + d.dailySpendLimitUsd.toFixed(2) + " / day"} />
          <Stat label="Research tokens today" value={(d.days[d.days.length - 1]?.research ?? 0).toLocaleString()} hint={`Budget ${d.dailyBudget.toLocaleString()} / day`} />
          <Stat label="Chat tokens today" value={(d.days[d.days.length - 1]?.chat ?? 0).toLocaleString()} />
          <Stat label="Models used" value={<span className="text-base">{d.models.join(", ") || "none"}</span>} />
        </div>
        <div className="h-56" role="img" aria-label="Daily AI tokens">
          <ResponsiveContainer>
            <BarChart data={d.days} margin={{ left: -10, right: 4, top: 8 }}>
              <CartesianGrid stroke="#273242" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="day" stroke="#6b7787" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#6b7787" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#111722", border: "1px solid #273242", borderRadius: 10, fontSize: 12 }} cursor={{ fill: "rgb(131 181 255 / 0.06)" }} />
              <Bar dataKey="research" name="Research" stackId="a" fill="#83b5ff" />
              <Bar dataKey="chat" name="Chat" stackId="a" fill="#c7d0dc" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
