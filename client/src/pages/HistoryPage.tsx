import { DashboardLayout } from "@/components/DashboardLayout";
import { useAnalyses } from "@/hooks/use-analysis";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, User, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Analysis } from "@/types/analysis";
import "./HistoryPage.css";

function parseAnalysisContext(analysis: Analysis) {
  const fallback = String(analysis.content || "").trim();
  if (!fallback) {
    return { title: "No content", subtitle: "No analysis payload available" };
  }

  try {
    const parsed = JSON.parse(fallback);
    if (analysis.contentType === "profile" && parsed && typeof parsed === "object") {
      const username = String(parsed.username || parsed.analyzedUsername || "").trim();
      const fullName = String(parsed.fullName || parsed.full_name || "").trim();
      return {
        title: username ? `@${username}` : "Profile analysis",
        subtitle: fullName || "Profile page analyzed",
      };
    }
    if (analysis.contentType === "message" && parsed && typeof parsed === "object") {
      const conversationName = String(parsed.conversationName || "").trim();
      const messages = Array.isArray(parsed.messages)
        ? parsed.messages
        : (Array.isArray(parsed.rawMessages) ? parsed.rawMessages : []);
      const normalized = messages.map((msg: unknown) => String(msg || "").trim()).filter(Boolean);
      if (normalized.length > 0) {
        return {
          title: normalized[0],
          subtitle: `${conversationName ? `@${conversationName} - ` : ""}${normalized.length} message${normalized.length > 1 ? "s" : ""} analyzed`,
        };
      }
    }
  } catch {
    // non-JSON payload fallback
  }

  return {
    title: fallback.slice(0, 140),
    subtitle: analysis.contentType === "profile" ? "Profile payload analyzed" : "Message payload analyzed",
  };
}

export default function HistoryPage() {
  const { data: analyses, isLoading } = useAnalyses();
  const [search, setSearch] = useState("");

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const filteredAnalyses = analyses?.filter((a) => {
    const context = parseAnalysisContext(a);
    const query = search.toLowerCase();
    return (
      String(a.content || "").toLowerCase().includes(query) ||
      String(a.explanation || "").toLowerCase().includes(query) ||
      String(context.title || "").toLowerCase().includes(query) ||
      String(context.subtitle || "").toLowerCase().includes(query)
    );
  }) || [];

  return (
      <DashboardLayout>
      <div className="history-shell">
      <div className="history-header">
        <div>
          <h1 className="history-title">Analysis History</h1>
          <p className="history-subtitle">Archive of all your security scans.</p>
        </div>
        <div className="history-search">
          <Search className="history-search-icon" />
          <Input 
            placeholder="Search history..." 
            className="history-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="history-list">
        {filteredAnalyses.length === 0 ? (
          <div className="history-empty">
            <p>No analyses found matching your search.</p>
          </div>
        ) : (
          filteredAnalyses.map((analysis) => {
            const context = parseAnalysisContext(analysis);
            return (
            <Link key={analysis.id} to={`/analysis/${analysis.id}`} className="history-link">
              <div className="history-card">
                {/* Icon */}
                <div className={cn(
                  "history-card-icon",
                  analysis.contentType === 'message' 
                    ? "history-card-icon-message" 
                    : "history-card-icon-profile"
                )}>
                  {analysis.contentType === 'message' ? <MessageSquare className="h-6 w-6" /> : <User className="h-6 w-6" />}
                </div>
                
                {/* Content */}
                <div className="history-card-body">
                  <div className="history-card-title-row">
                    <span className="history-card-title">
                      {analysis.contentType} Check
                    </span>
                    <span className="history-card-tag">
                      #{analysis.id}
                    </span>
                  </div>
                  <p className="history-card-context">
                    {context.title}
                  </p>
                  <p className="history-card-subtitle">
                    {context.subtitle}
                  </p>
                  <p className="history-card-time">
                    {analysis.createdAt && format(new Date(analysis.createdAt), "MMM d, yyyy - h:mm a")}
                  </p>
                </div>

                {/* Score */}
                <div className="history-card-score">
                  <div className={cn(
                    "history-score-value",
                    analysis.riskScore > 70 ? "history-score-high" : analysis.riskScore > 30 ? "history-score-mid" : "history-score-low"
                  )}>
                    {analysis.riskScore}%
                  </div>
                  <div className={cn(
                    "history-score-badge",
                    analysis.riskScore > 70 ? "history-badge-high" : analysis.riskScore > 30 ? "history-badge-mid" : "history-badge-low"
                  )}>
                    {analysis.riskScore > 70 ? "High Risk" : analysis.riskScore > 30 ? "Medium" : "Safe"}
                  </div>
                </div>
              </div>
            </Link>
          )})
        )}
      </div>
      </div>
    </DashboardLayout>
  );
}
