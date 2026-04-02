import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useCreateAnalysis } from "@/hooks/use-analysis";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MessageSquare, User, AlertTriangle, Loader2, Link } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { analyzeHeuristics } from "@/lib/heuristic-analyzer";
import { ScrapedProfile } from "@/types/scraper";
import { getAuthToken } from "@/lib/token-store";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildClientMessageHeuristics(content: string) {
  const messages = content
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const joined = messages.join("\n");
  const lower = joined.toLowerCase();
  const links = joined.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi) || [];
  const suspiciousLinks = joined.match(/bit\.ly|tinyurl|t\.me|wa\.me|cutt\.ly|rb\.gy|is\.gd|\.xyz\b|\.top\b|\.click\b/gi) || [];
  const credentialHits = (lower.match(/\b(password|otp|pin|cvv|2fa|login|verification code|bank account)\b/g) || []).length;
  const impersonationHits = (lower.match(/\b(instagram support|security team|official|admin|help center|customer care)\b/g) || []).length;
  const pressureHits = (lower.match(/\b(urgent|act now|hurry|send money|upi|wire|transfer|processing fee|advance payment)\b/g) || []).length;
  const scamHits = (lower.match(/\b(crypto|reward|claim|lottery|double money|guaranteed return)\b/g) || []).length;
  const uniqueRatio = messages.length > 0 ? new Set(messages.map((m) => m.toLowerCase())).size / messages.length : 1;
  const repetitionRatio = 1 - uniqueRatio;

  const urgentScore = clampPercent((pressureHits * 12) + (credentialHits * 14) + (impersonationHits * 10) + (suspiciousLinks.length * 16));
  const spamScore = clampPercent((repetitionRatio * 60) + (messages.length >= 12 ? 15 : 0) + (scamHits * 8));
  const behavioralScore = clampPercent((messages.length >= 20 ? 25 : messages.length >= 8 ? 12 : 5) + (repetitionRatio * 35));
  const overallRisk = clampPercent((urgentScore * 0.55) + (spamScore * 0.25) + (behavioralScore * 0.2));
  const evidenceQuality = clampPercent((messages.length >= 12 ? 35 : messages.length >= 5 ? 25 : 12) + (links.length > 0 ? 20 : 8) + (joined.length >= 200 ? 20 : 10));
  const riskClass = overallRisk >= 70 ? "high-risk" : overallRisk >= 40 ? "suspicious" : "likely-human";

  return {
    overallRisk,
    urgentScore,
    spamScore,
    behavioralScore,
    evidenceQuality,
    riskClass,
    messageCount: messages.length,
    linkCount: links.length,
    suspiciousLinkCount: suspiciousLinks.length,
    credentialHits,
    impersonationHits,
    pressureHits,
    scamHits,
    repetitionRatio: Number(repetitionRatio.toFixed(3)),
    source: "analyze-page-client",
  };
}

const formSchema = z.object({
  contentType: z.enum(["message", "profile"]),
  content: z.string().min(10, "Please enter at least 10 characters for analysis."),
  url: z.string().url("Please enter a valid URL.").optional().or(z.literal('')),
});

export default function AnalyzePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mutation = useCreateAnalysis();
  const [isScraping, setIsScraping] = useState(false);
  const initialType = searchParams.get("type") === "message" ? "message" : "profile";
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contentType: initialType,
      content: "",
      url: "",
    },
  });

  useEffect(() => {
    const typeParam = searchParams.get("type");
    if (typeParam === "message" || typeParam === "profile") {
      form.setValue("contentType", typeParam);
    }
  }, [searchParams, form]);

  const handleScrape = async () => {
    const url = form.getValues("url");
    if (!url) {
      form.setError("url", { type: "manual", message: "URL is required for scraping." });
      return;
    }
    
    setIsScraping(true);
    form.setValue("content", "Scraping in progress...");
    try {
      const response = await fetch('http://localhost:5000/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error('Scraping request failed.');
      }

      const data = await response.json();
      form.setValue("content", data.content);
    } catch (error) {
      console.error(error);
      form.setError("content", { type: "manual", message: "Failed to scrape the URL." });
    } finally {
      setIsScraping(false);
    }
  };


  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // attempt client-side heuristic for profiles
    if (values.contentType === "profile") {
      try {
        const profile: ScrapedProfile = JSON.parse(values.content);
        const heur = await analyzeHeuristics(profile, 0); // Await the async function
        const token = getAuthToken();
        if (token) {
          await fetch("http://localhost:5000/api/analyses/client", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              contentType: "profile",
              content: values.content,
              heuristics: heur,
            }),
          });
        }
        // navigate to heuristic page
        navigate("/heuristic-analysis", { state: { analysis: heur } } as any);
        return;
      } catch (err) {
        console.error("Failed to parse profile JSON for heuristics", err);
      }
    }

    if (values.contentType === "message") {
      try {
        const token = getAuthToken();
        if (token) {
          const messageHeuristics = buildClientMessageHeuristics(values.content);
          const shouldForceDeepVerification =
            messageHeuristics.overallRisk >= 70 ||
            messageHeuristics.credentialHits > 0 ||
            messageHeuristics.impersonationHits > 0 ||
            messageHeuristics.suspiciousLinkCount > 0;
          const clientRes = await fetch("http://localhost:5000/api/analyses/client", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              contentType: "message",
              content: values.content,
              heuristics: messageHeuristics,
            }),
          });
          if (clientRes.ok) {
            const payload = await clientRes.json();
            if (payload?.id && !shouldForceDeepVerification) {
              navigate(`/analysis/${payload.id}`);
              return;
            }
          }
        }
      } catch (err) {
        console.error("Client-side message analysis persistence failed, falling back to server deep analysis", err);
      }
    }

    // fallback: submit to server only
    try {
      const result = await mutation.mutateAsync({
        contentType: values.contentType,
        content: values.content,
        url: values.url,
      });

      if (result && result.id) {
        navigate(`/analysis/${result.id}`);
      }
    } catch (error) {
      console.error("Analysis submission failed:", error);
      form.setError("content", {
        type: "manual",
        message: "Failed to submit analysis. Please try again.",
      });
    }
  };
  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight mb-2">New Analysis</h1>
          <p className="text-slate-500">Scrape a social media profile or paste suspicious text for an instant AI risk assessment.</p>
        </div>

        <Card className="border-none shadow-xl bg-white dark:bg-slate-900 overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-primary to-accent" />
          <CardContent className="p-6 md:p-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <Label className="text-base font-semibold flex items-center">
                        <Link className="mr-2 h-5 w-5" />
                        Scrape Profile URL
                      </Label>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            placeholder="e.g., https://www.instagram.com/username"
                            className="h-12 text-base"
                            {...field}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-12 flex items-center justify-center"
                          onClick={handleScrape}
                          disabled={isScraping}
                        >
                          {isScraping ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Scrape'}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white dark:bg-slate-900 px-2 text-muted-foreground">
                      Or Paste Manually
                    </span>
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="contentType"
                  render={({ field }: { field: any }) => (
                    <FormItem className="space-y-3">
                      <Label className="text-base font-semibold">What are you analyzing?</Label>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="grid grid-cols-1 md:grid-cols-2 gap-4"
                        >
                          <FormItem>
                            <FormControl>
                              <RadioGroupItem value="message" className="peer sr-only" />
                            </FormControl>
                            <Label
                              htmlFor="message"
                              className={cn(
                                "flex flex-col items-center justify-between rounded-xl border-2 border-muted bg-transparent p-4 hover:bg-slate-50 hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary cursor-pointer transition-all",
                                field.value === "message" && "border-primary bg-primary/5 text-primary"
                              )}
                            >
                              <MessageSquare className="mb-3 h-6 w-6" />
                              <span className="font-semibold">Suspicious Message</span>
                              <span className="text-xs text-muted-foreground mt-1 text-center">DM, Email, or Text</span>
                            </Label>
                          </FormItem>
                          <FormItem>
                            <FormControl>
                              <RadioGroupItem value="profile" className="peer sr-only" />
                            </FormControl>
                            <Label
                              htmlFor="profile"
                              className={cn(
                                "flex flex-col items-center justify-between rounded-xl border-2 border-muted bg-transparent p-4 hover:bg-slate-50 hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary cursor-pointer transition-all",
                                field.value === "profile" && "border-primary bg-primary/5 text-primary"
                              )}
                            >
                              <User className="mb-3 h-6 w-6" />
                              <span className="font-semibold">Profile / Bio</span>
                              <span className="text-xs text-muted-foreground mt-1 text-center">Bio, Username, Claims</span>
                            </Label>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <Label className="text-base font-semibold">Content</Label>
                      <FormControl>
                        <Textarea
                          placeholder={
                            form.watch("contentType") === "message"
                              ? "Paste the suspicious message here... e.g. 'Congratulations! You've won an iPhone 15 Pro. Click here to claim...'"
                              : "Scraped data or manual entry will appear here."
                          }
                          className="min-h-[200px] resize-none text-base p-4 rounded-xl border-2 focus-visible:ring-offset-0"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex gap-3 text-sm text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <p>Do not include private personal information like passwords or credit card numbers in your analysis.</p>
                </div>

                <Button 
                  type="submit" 
                  size="lg" 
                  className="w-full rounded-xl h-14 text-lg font-semibold shadow-xl shadow-primary/20"
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    "Run Security Scan"
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
