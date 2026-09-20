/**
 * Workspaces Page
 */
import React, { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Input, Textarea } from "../components/forms";
import { Modal } from "../components/dialogs";
import { EmptyState, LoadingSpinner } from "../components/ui/utility-components";
import { PlusIcon, ServerIcon, EditIcon, TrashIcon } from "../components/icons";
import { workspaceApi } from "../utils/api";
import { useWorkspaceStore, useUIStore } from "../stores";

export function WorkspacesPage(): JSX.Element {
  const { workspaces, isLoading, setWorkspaces, setLoading } = useWorkspaceStore();
  const addNotification = useUIStore((s) => s.addNotification);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => { loadWorkspaces(); }, []);

  const loadWorkspaces = async () => {
    setLoading(true);
    try {
      const data = await workspaceApi.list();
      setWorkspaces(data);
    } catch {
      addNotification({ type: "error", title: "Error", message: "Failed to load workspaces" });
    }
  };

  const createWorkspace = async () => {
    if (!newName.trim()) return;
    try {
      await workspaceApi.create({ name: newName, description: newDesc });
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      loadWorkspaces();
      addNotification({ type: "success", title: "Created", message: `Workspace "${newName}" created` });
    } catch (err: any) {
      addNotification({ type: "error", title: "Error", message: err.detail || "Failed to create workspace" });
    }
  };

  const deleteWorkspace = async (id: string, name: string) => {
    if (!confirm(`Delete workspace "${name}"?`)) return;
    try {
      await workspaceApi.delete(id);
      loadWorkspaces();
      addNotification({ type: "success", title: "Deleted", message: `Workspace "${name}" deleted` });
    } catch (err: any) {
      addNotification({ type: "error", title: "Error", message: err.detail || "Failed to delete" });
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <h1>Workspaces</h1>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <PlusIcon size={16} /> New Workspace
        </Button>
      </div>

      {isLoading ? (
        <LoadingSpinner size="lg" />
      ) : workspaces.length === 0 ? (
        <EmptyState
          icon={<ServerIcon size={48} />}
          title="No workspaces"
          description="Create a workspace to organize your assessments."
          action={
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              <PlusIcon size={16} /> Create Workspace
            </Button>
          }
        />
      ) : (
        <div className="card-grid">
          {workspaces.map((ws: any) => (
            <div key={ws.id} className="workspace-card">
              <div className="workspace-card__header">
                <ServerIcon size={24} />
                <h3>{ws.name}</h3>
              </div>
              {ws.description && <p className="workspace-card__desc">{ws.description}</p>}
              <div className="workspace-card__actions">
                <Button variant="ghost" size="sm" onClick={() => deleteWorkspace(ws.id, ws.name)}>
                  <TrashIcon size={14} /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Workspace" size="sm">
        <Input
          label="Name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Workspace name"
          autoFocus
        />
        <Textarea
          label="Description (optional)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Brief description"
        />
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button variant="primary" onClick={createWorkspace} disabled={!newName.trim()}>Create</Button>
        </div>
      </Modal>
    </div>
  );
}
