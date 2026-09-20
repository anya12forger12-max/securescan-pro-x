/**
 * Assessments Page
 */
import React, { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Input, Textarea, Select } from "../components/forms";
import { Modal } from "../components/dialogs";
import { EmptyState, LoadingSpinner, SeverityBadge } from "../components/ui/utility-components";
import { PlusIcon, SearchIcon, PlayIcon, StopIcon, ClockIcon } from "../components/icons";
import { assessmentApi } from "../utils/api";
import { useUIStore } from "../stores";

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--text-muted)",
  queued: "var(--status-info)",
  running: "var(--status-warning)",
  completed: "var(--status-success)",
  failed: "var(--status-error)",
  cancelled: "var(--text-muted)",
  paused: "var(--status-warning)",
};

export function AssessmentsPage(): JSX.Element {
  const [assessments, setAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", priority: "normal" });
  const addNotification = useUIStore((s) => s.addNotification);

  useEffect(() => { loadAssessments(); }, []);

  const loadAssessments = async () => {
    setLoading(true);
    try {
      const data = await assessmentApi.list();
      setAssessments(data);
    } catch {
      addNotification({ type: "error", title: "Error", message: "Failed to load assessments" });
    } finally {
      setLoading(false);
    }
  };

  const createAssessment = async () => {
    if (!form.name.trim()) return;
    try {
      await assessmentApi.create({
        name: form.name,
        description: form.description,
        priority: form.priority,
      });
      setShowCreate(false);
      setForm({ name: "", description: "", priority: "normal" });
      loadAssessments();
      addNotification({ type: "success", title: "Created", message: `Assessment "${form.name}" created` });
    } catch (err: any) {
      addNotification({ type: "error", title: "Error", message: err.detail || "Failed" });
    }
  };

  const startAssessment = async (id: string) => {
    try {
      await assessmentApi.start(id);
      loadAssessments();
      addNotification({ type: "success", title: "Started", message: "Assessment started" });
    } catch (err: any) {
      addNotification({ type: "error", title: "Error", message: err.detail || "Failed to start" });
    }
  };

  const cancelAssessment = async (id: string) => {
    try {
      await assessmentApi.cancel(id);
      loadAssessments();
      addNotification({ type: "info", title: "Cancelled", message: "Assessment cancelled" });
    } catch (err: any) {
      addNotification({ type: "error", title: "Error", message: err.detail || "Failed to cancel" });
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <h1>Assessments</h1>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <PlusIcon size={16} /> New Assessment
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner size="lg" />
      ) : assessments.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={48} />}
          title="No assessments"
          description="Create an assessment to start scanning your assets."
        />
      ) : (
        <div className="assessment-grid">
          {assessments.map((a: any) => (
            <div key={a.id} className="assessment-card">
              <div className="assessment-card__header">
                <h3>{a.name}</h3>
                <span className="status-badge" style={{ color: STATUS_COLORS[a.status] || "var(--text-secondary)" }}>
                  {a.status}
                </span>
              </div>
              {a.description && <p className="assessment-card__desc">{a.description}</p>}
              <div className="assessment-card__meta">
                <span><ClockIcon size={14} /> {new Date(a.created_at).toLocaleDateString()}</span>
                <span className={`priority-badge priority-badge--${a.priority}`}>{a.priority}</span>
              </div>
              <div className="assessment-card__actions">
                {(a.status === "draft" || a.status === "queued") && (
                  <Button variant="primary" size="sm" onClick={() => startAssessment(a.id)}>
                    <PlayIcon size={14} /> Start
                  </Button>
                )}
                {a.status === "running" && (
                  <Button variant="danger" size="sm" onClick={() => cancelAssessment(a.id)}>
                    <StopIcon size={14} /> Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Assessment" size="md">
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Assessment name"
        />
        <Textarea
          label="Description (optional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What are you assessing?"
        />
        <Select
          label="Priority"
          options={PRIORITIES}
          value={form.priority}
          onChange={(v) => setForm({ ...form, priority: v })}
        />
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button variant="primary" onClick={createAssessment} disabled={!form.name.trim()}>Create</Button>
        </div>
      </Modal>
    </div>
  );
}
