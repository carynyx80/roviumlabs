"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { stroke: "#6b7787", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "#111722", border: "1px solid #273242", borderRadius: 10, fontSize: 12 },
  labelStyle: { color: "#99a5b5" },
  cursor: { fill: "rgb(131 181 255 / 0.06)" },
};

export function RunsChart({ data }: { data: { day: string; completed: number; failed: number }[] }) {
  return (
    <div className="h-48 w-full" role="img" aria-label="Research runs per day, last 14 days">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="#273242" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="day" {...axis} />
          <YAxis allowDecimals={false} {...axis} />
          <Tooltip {...tooltipStyle} />
          <Bar dataKey="completed" name="Completed" stackId="a" fill="#83b5ff" radius={[0, 0, 0, 0]} />
          <Bar dataKey="failed" name="Failed" stackId="a" fill="#ff7a85" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RiskChart({ data }: { data: { at: string; score: number; confidence: number }[] }) {
  return (
    <div className="h-48 w-full" role="img" aria-label="Aggregate risk score and confidence per report">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="#273242" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="at" {...axis} />
          <YAxis domain={[0, 100]} {...axis} />
          <Tooltip {...tooltipStyle} />
          <Line type="monotone" dataKey="score" name="Risk score" stroke="#c7d0dc" strokeWidth={2} dot={{ r: 2.5 }} />
          <Line type="monotone" dataKey="confidence" name="Confidence" stroke="#83b5ff" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
