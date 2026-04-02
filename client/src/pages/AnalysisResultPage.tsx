import { DashboardLayout } from "@/components/DashboardLayout";
import { useAnalysis } from "@/hooks/use-analysis";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Loader2, ShieldAlert, CheckCircle, AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RiskMeter } from "@/components/RiskMeter";
import { Card } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";

export default function AnalysisResultPage() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  const { data: analysis, isLoading, error } = useAnalysis(id);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="h-[60vh] flex flex-col items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
          <h2 className="text-xl font-semibold">Retrieving Analysis Results...</h2>
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold mb-4">{error.message}</h2>
          <Link to="/dashboard">
            <Button>Return to Dashboard</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  if (!analysis) {
    return (
      <DashboardLayout>
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold mb-4">Analysis Not Found</h2>
          <Link to="/dashboard">
            <Button>Return to Dashboard</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  // Parse flags if they are stored as JSON string, though schema says string[]
  const flags = Array.isArray(analysis.flags) ? analysis.flags : [];
  const messageReport = analysis.heuristics?.messageReport;
  const messageSignals = analysis.heuristics?.messageCategorySignals;
  const hasMessageInsights = analysis.contentType === "message" && (messageReport || messageSignals);

  return (
    <DashboardLayout>
      <div className="mb-6">
        <Link to="/dashboard">
          <Button variant="ghost" className="pl-0 hover:pl-0 hover:bg-transparent text-slate-500 hover:text-primary transition-colors">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Result Column */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-xl border border-slate-100 dark:border-slate-800">
            <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
              Analysis Results
              <span className="text-xs font-normal text-muted-foreground bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-full">
                #{analysis.id}
              </span>
            </h1>

            <div className="mb-8">
              <RiskMeter score={analysis.riskScore} />
            </div>

            <div className="prose dark:prose-invert max-w-none">
              <h3 className="text-lg font-semibold mb-3">AI Assessment</h3>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-950 p-6 rounded-2xl border border-slate-100 dark:border-slate-800">
                {analysis.explanation}
              </p>

              {/* heuristic breakdown if available */}
              {analysis.heuristics && (
                <div className="mt-6">
                  <h4 className="text-md font-semibold mb-2">Client Heuristics</h4>
                  <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                    {JSON.stringify(analysis.heuristics, null, 2)}
                  </pre>
                </div>
              )}

              {hasMessageInsights && (
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {messageReport && (
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                      <h4 className="font-semibold mb-2">Message Risk Report</h4>
                      <div className="text-sm space-y-1">
                        <div><strong>Messages:</strong> {Number(messageReport.totalMessages || 0)}</div>
                        <div><strong>Final Risk:</strong> {Number(messageReport.finalMessageRiskScore || 0)}%</div>
                        <div><strong>ML Risk:</strong> {Number(messageReport.mlThreatScore || 0)}%</div>
                        <div><strong>Heuristic Risk:</strong> {Number(messageReport.heuristicThreatScore || 0)}%</div>
                        <div><strong>Evidence Quality:</strong> {Number(messageReport.evidenceQuality || 0)}%</div>
                      </div>
                    </div>
                  )}
                  {messageSignals && (
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                      <h4 className="font-semibold mb-2">Safety Category Signals</h4>
                      <div className="text-sm space-y-1">
                        <div><strong>Self-harm:</strong> {Number(messageSignals.selfHarmCount || 0)}</div>
                        <div><strong>Violence Threat:</strong> {Number(messageSignals.violenceThreatCount || 0)}</div>
                        <div><strong>Sextortion/Blackmail:</strong> {Number(messageSignals.blackmailSextortionCount || 0)}</div>
                        <div><strong>Sexual Solicitation:</strong> {Number(messageSignals.sexualSolicitationCount || 0)}</div>
                        <div><strong>Harassment:</strong> {Number(messageSignals.harassmentCount || 0)}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* server side risk details */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysis.structuralRisk !== undefined && (
                  <div>
                    <strong>Structural Risk:</strong> {analysis.structuralRisk}
                  </div>
                )}
                {analysis.contentRisk !== undefined && (
                  <div>
                    <strong>Content Risk:</strong> {analysis.contentRisk}
                  </div>
                )}
                {analysis.behavioralRisk !== undefined && (
                  <div>
                    <strong>Behavioral Risk:</strong> {analysis.behavioralRisk}
                  </div>
                )}
                {analysis.photoRisk !== undefined && (
                  <div>
                    <strong>Photo Risk:</strong> {analysis.photoRisk}
                  </div>
                )}
                {analysis.preliminaryRisk !== undefined && (
                  <div>
                    <strong>Preliminary Total:</strong> {analysis.preliminaryRisk}
                  </div>
                )}
                {analysis.anomalyScore !== undefined && (
                  <div>
                    <strong>Anomaly Score:</strong> {analysis.anomalyScore}
                  </div>
                )}
                {analysis.modelConfidence !== undefined && (
                  <div>
                    <strong>Model Confidence:</strong> {analysis.modelConfidence}%
                  </div>
                )}
                {analysis.riskClassification && (
                  <div>
                    <strong>Classification:</strong> {analysis.riskClassification}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-lg border border-slate-100 dark:border-slate-800">
            <h3 className="text-lg font-semibold mb-6">Analyzed Content</h3>
            <div className="bg-slate-50 dark:bg-slate-950 p-6 rounded-xl border border-slate-200 dark:border-slate-800 font-mono text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-96 overflow-y-auto">
              {analysis.content}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
           <Card className="p-6 border-none shadow-lg bg-white dark:bg-slate-900">
             <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">Detection Flags</h3>
             {flags.length === 0 ? (
               <div className="flex items-center gap-3 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl">
                 <CheckCircle className="h-5 w-5" />
                 <span className="font-medium">No red flags detected</span>
               </div>
             ) : (
               <div className="space-y-3">
                 {flags.map((flag, i) => (
                   <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/30">
                     <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                     <span className="text-sm font-medium text-rose-900 dark:text-rose-200">{flag}</span>
                   </div>
                 ))}
               </div>
             )}
           </Card>

           <Card className="p-6 border-none shadow-lg bg-white dark:bg-slate-900">
             <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">Details</h3>
             <div className="space-y-4 text-sm">
               <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                 <span className="text-slate-500">Type</span>
                 <span className="font-medium capitalize">{analysis.contentType}</span>
               </div>
               <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                 <span className="text-slate-500">Date</span>
                 <span className="font-medium">
                   {analysis.createdAt && new Date(analysis.createdAt).toLocaleDateString()}
                 </span>
               </div>
               <div className="flex justify-between py-2">
                 <span className="text-slate-500">Time Ago</span>
                 <span className="font-medium">
                   {analysis.createdAt && formatDistanceToNow(new Date(analysis.createdAt), { addSuffix: true })}
                 </span>
               </div>
             </div>
           </Card>
           
           <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-6 border border-blue-100 dark:border-blue-800">
             <div className="flex items-center gap-2 mb-2 text-blue-700 dark:text-blue-300 font-semibold">
               <AlertTriangle className="h-4 w-4" />
               Disclaimer
             </div>
             <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">
               This analysis is generated by AI and may not be 100% accurate. Always verify sources independently before taking financial action.
             </p>
           </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
