"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";

export function FunnelChart({
  data,
}: {
  data: Array<{ stage: string; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical">
        <XAxis type="number" />
        <YAxis type="category" dataKey="stage" width={150} />
        <Tooltip />
        <Bar dataKey="count" fill="hsl(222.2 47.4% 30%)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CpsvbByLanguageChart({
  data,
}: {
  data: Array<{ language: string; cpsvb: number; visits: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="language" />
        <YAxis />
        <Tooltip formatter={(v: number) => `₹${Math.round(v)}`} />
        <Bar dataKey="cpsvb" fill="hsl(160 60% 35%)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PickupByHourChart({
  data,
}: {
  data: Array<{ hour: number; pickup_rate: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="hour" />
        <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
        <Legend />
        <Line type="monotone" dataKey="pickup_rate" stroke="hsl(222.2 47.4% 40%)" />
      </LineChart>
    </ResponsiveContainer>
  );
}
