/**
 * Assets Page
 */
import React, { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Input, Select, Textarea } from "../components/forms";
import { Modal } from "../components/dialogs";
import { EmptyState, LoadingSpinner } from "../components/ui/utility-components";
import { PlusIcon, GlobeIcon, TrashIcon } from "../components/icons";
import { assetApi } from "../utils/api";
import { useUIStore } from "../stores";

const ASSET_TYPES = [
  { value: "host", label: "Host" },
  { value: "network", label: "Network" },
  { value: "web", label: "Web Application" },
  { value: "cloud", label: "Cloud" },
  { value: "container", label: "Container" },
];

export function AssetsPage(): JSX.Element {
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", assetType: "host", identifier: "", description: "" });
  const addNotification = useUIStore((s) => s.addNotification);

  useEffect(() => { loadAssets(); }, []);

  const loadAssets = async () => {
    setLoading(true);
    try {
      const data = await assetApi.list();
      setAssets(data);
    } catch {
      addNotification({ type: "error", title: "Error", message: "Failed to load assets" });
    } finally {
      setLoading(false);
    }
  };

  const createAsset = async () => {
    if (!form.name.trim() || !form.identifier.trim()) return;
    try {
      await assetApi.create({
        name: form.name,
        asset_type: form.assetType,
        identifier: form.identifier,
      });
      setShowCreate(false);
      setForm({ name: "", assetType: "host", identifier: "", description: "" });
      loadAssets();
      addNotification({ type: "success", title: "Created", message: `Asset "${form.name}" created` });
    } catch (err: any) {
      addNotification({ type: "error", title: "Error", message: err.detail || "Failed to create asset" });
    }
  };

  const deleteAsset = async (id: string, name: string) => {
    if (!confirm(`Delete asset "${name}"?`)) return;
    try {
      await assetApi.delete(id);
      loadAssets();
      addNotification({ type: "success", title: "Deleted", message: `Asset "${name}" deleted` });
    } catch (err: any) {
      addNotification({ type: "error", title: "Error", message: err.detail || "Failed to delete" });
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <h1>Assets</h1>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <PlusIcon size={16} /> New Asset
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner size="lg" />
      ) : assets.length === 0 ? (
        <EmptyState
          icon={<GlobeIcon size={48} />}
          title="No assets"
          description="Add hosts, networks, or web applications to scan."
        />
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table" role="grid">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Identifier</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a: any) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td><span className={`type-badge type-badge--${a.asset_type}`}>{a.asset_type}</span></td>
                  <td><code>{a.identifier}</code></td>
                  <td>
                    <Button variant="ghost" size="sm" onClick={() => deleteAsset(a.id, a.name)}>
                      <TrashIcon size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Add Asset" size="md">
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g., Web Server 1"
        />
        <Select
          label="Type"
          options={ASSET_TYPES}
          value={form.assetType}
          onChange={(v) => setForm({ ...form, assetType: v })}
        />
        <Input
          label="Identifier"
          value={form.identifier}
          onChange={(e) => setForm({ ...form, identifier: e.target.value })}
          placeholder="e.g., 192.168.1.100 or https://example.com"
        />
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button variant="primary" onClick={createAsset} disabled={!form.name.trim() || !form.identifier.trim()}>Add</Button>
        </div>
      </Modal>
    </div>
  );
}
