"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2, MapPin, Pencil, ShieldCheck, Trash2, X } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import type { ChecklistItem } from "@/lib/checklist";
import type { UserFact } from "@/lib/user-facts";

type StoredList = { id: string; activityKey: string; seriesId: string | null; items: ChecklistItem[] };
type Location = { lat: number; lon: number } | null;

const humanize = (key: string) => key.replace(/_/g, " ");

async function call(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}

/**
 * "Lo que Spark sabe de vos": todo lo que Spark recuerda del usuario, a la vista, para
 * editar y borrar. Borrar es real: cada botón termina en un DELETE.
 */
export function KnowledgePage() {
  const { copy } = useAppLanguage();
  const t = copy.knowledge;

  const [facts, setFacts] = useState<UserFact[] | null>(null);
  const [lists, setLists] = useState<StoredList[] | null>(null);
  const [location, setLocation] = useState<Location>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [f, l, loc] = await Promise.all([call("/api/facts"), call("/api/checklists"), call("/api/settings/location")]);
    if (!f?.ok || !l?.ok) {
      setError(t.error);
      return;
    }
    setFacts(((await f.json()) as { facts: UserFact[] }).facts);
    setLists(((await l.json()) as { lists: StoredList[] }).lists);
    if (loc?.ok) setLocation(((await loc.json()) as { location: Location }).location);
  }, [t.error]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(request: Promise<Response | null>, after: () => void) {
    setBusy(true);
    setError(null);
    const res = await request;
    setBusy(false);
    if (res?.ok) {
      after();
      return;
    }
    // Un hecho sensible que se intenta editar vuelve 422: se explica, no se dice "algo salió mal".
    setError(res?.status === 422 ? t.sensitive : t.error);
  }

  const saveEdit = () =>
    editing &&
    run(call("/api/facts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, value: editing.value }) }), () => {
      setEditing(null);
      void load();
    });

  const removeFact = (id: string) =>
    run(call(`/api/facts?id=${encodeURIComponent(id)}`, { method: "DELETE" }), () => {
      setConfirming(null);
      setFacts((prev) => prev?.filter((f) => f.id !== id) ?? prev);
    });

  const removeAll = () =>
    run(
      Promise.all([call("/api/facts?all=1", { method: "DELETE" }), call("/api/checklists?all=1", { method: "DELETE" }), call("/api/settings/location", { method: "DELETE" })]).then((rs) =>
        rs.every((r) => r?.ok) ? new Response(null, { status: 200 }) : null
      ),
      () => {
        setConfirming(null);
        setFacts([]);
        setLists([]);
        setLocation(null);
      }
    );

  const removeList = (id: string) =>
    run(call(`/api/checklists?id=${encodeURIComponent(id)}`, { method: "DELETE" }), () => {
      setConfirming(null);
      setLists((prev) => prev?.filter((l) => l.id !== id) ?? prev);
    });

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError(t.locationUnsupported);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        void run(
          call("/api/settings/location", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: position.coords.latitude, lon: position.coords.longitude })
          }),
          () => void load()
        ),
      () => setError(t.locationDenied)
    );
  }

  const loaded = facts !== null && lists !== null;
  const empty = loaded && facts.length === 0 && lists.length === 0 && !location;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">
      <Link href="/app" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t.back}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> {t.sensitive}
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loaded ? (
        !error && <Loader2 className="mt-8 h-5 w-5 animate-spin text-muted-foreground" aria-label="loading" />
      ) : (
        <div className="mt-6 space-y-8">
          <section aria-labelledby="facts-title">
            <h2 id="facts-title" className="text-base font-semibold">{t.factsTitle}</h2>
            {facts.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t.factsEmpty}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {facts.map((fact) => (
                  <li key={fact.id} className="rounded-xl border border-border bg-card p-3" data-testid="fact">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{humanize(fact.key)}</p>
                        {editing?.id === fact.id ? (
                          <input
                            autoFocus
                            value={editing.value}
                            maxLength={200}
                            aria-label={humanize(fact.key)}
                            onChange={(event) => setEditing({ id: fact.id, value: event.target.value })}
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                          />
                        ) : (
                          <p className="mt-0.5 text-sm">{fact.value}</p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground">{fact.source === "stated" ? t.stated : t.inferred}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        {editing?.id === fact.id ? (
                          <>
                            <button type="button" disabled={busy} onClick={() => void saveEdit()} className="rounded p-1 text-primary" aria-label={t.save} title={t.save}>
                              <Check className="h-4 w-4" aria-hidden />
                            </button>
                            <button type="button" onClick={() => setEditing(null)} className="rounded p-1 text-muted-foreground" aria-label={t.cancel} title={t.cancel}>
                              <X className="h-4 w-4" aria-hidden />
                            </button>
                          </>
                        ) : confirming === fact.id ? (
                          <>
                            <span className="text-xs text-destructive">{t.confirmRemove}</span>
                            <button type="button" disabled={busy} onClick={() => void removeFact(fact.id)} className="rounded p-1 text-destructive" aria-label={t.remove} title={t.remove}>
                              <Check className="h-4 w-4" aria-hidden />
                            </button>
                            <button type="button" onClick={() => setConfirming(null)} className="rounded p-1 text-muted-foreground" aria-label={t.cancel} title={t.cancel}>
                              <X className="h-4 w-4" aria-hidden />
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => setEditing({ id: fact.id, value: fact.value })} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={`${t.edit}: ${humanize(fact.key)}`} title={t.edit}>
                              <Pencil className="h-4 w-4" aria-hidden />
                            </button>
                            <button type="button" onClick={() => setConfirming(fact.id)} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={`${t.remove}: ${humanize(fact.key)}`} title={t.remove}>
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="lists-title">
            <h2 id="lists-title" className="text-base font-semibold">{t.listsTitle}</h2>
            {lists.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t.listsEmpty}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {lists.map((list) => (
                  <li key={list.id} className="rounded-xl border border-border bg-card p-3" data-testid="list">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium capitalize">{humanize(list.activityKey)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{t.items(list.items.length)}</p>
                        <p className="mt-1 text-xs">{list.items.map((i) => i.text).join(" · ")}</p>
                      </div>
                      {confirming === list.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-destructive">{t.confirmRemove}</span>
                          <button type="button" disabled={busy} onClick={() => void removeList(list.id)} className="rounded p-1 text-destructive" aria-label={t.remove}>
                            <Check className="h-4 w-4" aria-hidden />
                          </button>
                          <button type="button" onClick={() => setConfirming(null)} className="rounded p-1 text-muted-foreground" aria-label={t.cancel}>
                            <X className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setConfirming(list.id)} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={`${t.remove}: ${humanize(list.activityKey)}`} title={t.remove}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="location-title">
            <h2 id="location-title" className="text-base font-semibold">{t.locationTitle}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t.locationHelp}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {location ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-sm" data-testid="location">
                    <MapPin className="h-4 w-4 text-primary" aria-hidden /> {t.locationSaved(location.lat, location.lon)}
                  </span>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(call("/api/settings/location", { method: "DELETE" }), () => setLocation(null))}>
                    {t.locationRemove}
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground">{t.locationNone}</span>
                  <Button size="sm" variant="outline" disabled={busy} onClick={useMyLocation}>
                    <MapPin className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t.locationUse}
                  </Button>
                </>
              )}
            </div>
          </section>

          {!empty && (
            <section>
              {confirming === "all" ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                  <span className="min-w-0 flex-1 text-sm text-destructive">{t.confirmRemoveAll}</span>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void removeAll()}>
                    {t.removeAll}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    {t.cancel}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming("all")}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t.removeAll}
                </Button>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
