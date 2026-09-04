#![allow(non_snake_case)]

use serde::Deserialize;
use chrono::{DateTime, Utc};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Deserialize)]
pub struct PodList { pub items: Vec<Pod> }

#[derive(Debug, Clone, Deserialize)]
pub struct Pod {
    pub metadata: PodMeta,
    pub spec: PodSpec,
    pub status: PodStatus,
}
#[derive(Debug, Clone, Deserialize)]
pub struct PodMeta { pub name: String, pub namespace: String, pub creationTimestamp: String }
#[derive(Debug, Clone, Deserialize)]
pub struct PodSpec { #[serde(default)] pub containers: Vec<NamedContainer>, #[serde(default)] pub nodeName: Option<String> }
#[derive(Debug, Clone, Deserialize)]
pub struct NamedContainer { pub name: String }
#[derive(Debug, Clone, Deserialize)]
pub struct PodStatus { pub phase: String, #[serde(default)] pub podIP: Option<String>,
    #[serde(default)] pub containerStatuses: Vec<ContainerStatus> }
#[derive(Debug, Clone, Deserialize)]
pub struct ContainerStatus { pub name: String, pub restartCount: i64, pub ready: bool,
    #[serde(default)] pub state: ContainerState,
    #[serde(default)] pub image: String,
    #[serde(default)] pub imageID: String }
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ContainerState {
    #[serde(default)] pub waiting: Option<WaitingState>,
    #[serde(default)] pub terminated: Option<TerminatedState>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct WaitingState { pub reason: String }
#[derive(Debug, Clone, Deserialize)]
pub struct TerminatedState { pub reason: String }

#[derive(Debug, Clone, Deserialize)]
pub struct NamespaceList { pub items: Vec<NamespaceItem> }
#[derive(Debug, Clone, Deserialize)]
pub struct NamespaceItem { pub metadata: NamespaceMeta }
#[derive(Debug, Clone, Deserialize)]
pub struct NamespaceMeta { pub name: String }

pub fn parse_namespace_list(json: &[u8]) -> std::io::Result<Vec<String>> {
    let list: NamespaceList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(list.items.into_iter().map(|i| i.metadata.name).collect())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ContainerImage { pub name: String, pub image: String, pub image_id: String }

#[derive(Debug, Clone, serde::Serialize)]
pub struct PodView {
    pub name: String, pub namespace: String, pub ready: String,
    pub status: String, pub restarts: i64, pub age: String,
    pub ip: String, pub node: String, pub containers: Vec<String>,
    pub container_images: Vec<ContainerImage>,
}

pub fn parse_pod_list(json: &[u8]) -> std::io::Result<Vec<PodView>> {
    let list: PodList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let now = Utc::now();
    let mut out = Vec::with_capacity(list.items.len());
    for p in list.items {
        let total = p.spec.containers.len() as i64;
        let ready_count = p.status.containerStatuses.iter().filter(|c| c.ready).count() as i64;
        let restarts: i64 = p.status.containerStatuses.iter().map(|c| c.restartCount).sum();
        // status: prefer first waiting reason, else terminated reason, else phase
        let status = p.status.containerStatuses.iter()
            .find_map(|c| c.state.waiting.as_ref().map(|w| w.reason.clone()))
            .or_else(|| p.status.containerStatuses.iter()
                .find_map(|c| c.state.terminated.as_ref().map(|t| t.reason.clone())))
            .unwrap_or(p.status.phase.clone());
        let age = age_string(&p.metadata.creationTimestamp, now);
        let containers = p.spec.containers.iter().map(|c| c.name.clone()).collect::<Vec<_>>();
        let container_images = p.status.containerStatuses.iter().map(|c| ContainerImage {
            name: c.name.clone(),
            image: c.image.clone(),
            image_id: c.imageID.clone(),
        }).collect();
        out.push(PodView {
            name: p.metadata.name,
            namespace: p.metadata.namespace,
            ready: format!("{}/{}", ready_count, total),
            status,
            restarts,
            age,
            ip: p.status.podIP.unwrap_or_default(),
            node: p.spec.nodeName.unwrap_or_default(),
            containers,
            container_images,
        });
    }
    Ok(out)
}

fn age_string(creation: &str, now: DateTime<Utc>) -> String {
    match DateTime::parse_from_rfc3339(creation) {
        Ok(t) => {
            let t = t.with_timezone(&Utc);
            let d = now.signed_duration_since(t);
            let secs = d.num_seconds();
            if secs < 0 { return "0s".into(); }
            if secs < 60 { return format!("{}s", secs); }
            if secs < 3600 { return format!("{}m", secs / 60); }
            if secs < 86400 { return format!("{}h", secs / 3600); }
            format!("{}d", secs / 86400)
        }
        Err(_) => String::new(),
    }
}

// ---------------------------------------------------------------------------
// ConfigMap parser
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ConfigMapList { pub items: Vec<ConfigMapItem> }
#[derive(Debug, Clone, Deserialize)]
pub struct ConfigMapItem {
    pub metadata: ConfigMapMeta,
    #[serde(default)] pub data: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct ConfigMapMeta { pub name: String }

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConfigMapView { pub name: String, pub keys: Vec<String> }

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConfigMapEntry { pub key: String, pub value: String }

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConfigMapDataView { pub name: String, pub entries: Vec<ConfigMapEntry> }

pub fn parse_configmap_list(json: &[u8]) -> std::io::Result<Vec<ConfigMapView>> {
    let list: ConfigMapList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(list.items.into_iter().map(|cm| ConfigMapView {
        name: cm.metadata.name,
        keys: cm.data.keys().cloned().collect(),
    }).collect())
}

/// Parse single-CM JSON (`kubectl get cm <name> -o json`): `{ metadata:{name}, data:{k:v} }`.
/// `data` absent → empty entries. BTreeMap iterates sorted by key → stable order.
pub fn parse_configmap_data(json: &[u8]) -> std::io::Result<ConfigMapDataView> {
    let cm: ConfigMapItem = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let entries = cm.data.into_iter()
        .map(|(k, v)| ConfigMapEntry { key: k, value: v })
        .collect();
    Ok(ConfigMapDataView { name: cm.metadata.name, entries })
}

// ---------------------------------------------------------------------------
// Event parser
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct EventList { pub items: Vec<EventItem> }
#[derive(Debug, Clone, Deserialize)]
pub struct EventItem {
    #[serde(default)] pub lastTimestamp: Option<String>,
    #[serde(default, rename = "type")] pub type_: Option<String>,
    #[serde(default)] pub reason: Option<String>,
    #[serde(default)] pub message: Option<String>,
    #[serde(default)] pub involvedObject: Option<InvolvedObject>,
}
#[derive(Debug, Clone, Default, Deserialize)]
pub struct InvolvedObject { #[serde(default)] pub name: Option<String> }

#[derive(Debug, Clone, serde::Serialize)]
pub struct EventView {
    pub last_timestamp: String, pub type_: String, pub reason: String,
    pub message: String, pub involved_name: String,
}

pub fn parse_event_list(json: &[u8]) -> std::io::Result<Vec<EventView>> {
    let list: EventList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let mut views: Vec<EventView> = list.items.into_iter().map(|e| EventView {
        last_timestamp: e.lastTimestamp.unwrap_or_default(),
        type_: e.type_.unwrap_or_default(),
        reason: e.reason.unwrap_or_default(),
        message: e.message.unwrap_or_default(),
        involved_name: e.involvedObject.and_then(|o| o.name).unwrap_or_default(),
    }).collect();
    // Sort descending by last_timestamp (RFC3339 lexical sort = chronological)
    views.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));
    Ok(views)
}

// ---------------------------------------------------------------------------
// Deployment parser
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct DeploymentList { pub items: Vec<DeploymentItem> }
#[derive(Debug, Clone, Deserialize)]
pub struct DeploymentItem {
    pub metadata: DeploymentMeta,
    pub spec: DeploymentSpec,
    #[serde(default)] pub status: DeploymentStatus,
}
#[derive(Debug, Clone, Deserialize)]
pub struct DeploymentMeta { pub name: String, pub namespace: String, pub creationTimestamp: String }
#[derive(Debug, Clone, Deserialize)]
pub struct DeploymentSpec {
    #[serde(default)] pub replicas: Option<i64>,
    #[serde(default)] pub template: DepTemplate,
}
#[derive(Debug, Clone, Default, Deserialize)]
pub struct DepTemplate { #[serde(default)] pub spec: DepTemplateSpec }
#[derive(Debug, Clone, Default, Deserialize)]
pub struct DepTemplateSpec { #[serde(default)] pub containers: Vec<DepContainer> }
#[derive(Debug, Clone, Default, Deserialize)]
#[allow(dead_code)]
pub struct DepContainer { #[serde(default)] pub name: String, #[serde(default)] pub image: String }

#[derive(Debug, Clone, Default, Deserialize)]
#[allow(dead_code)]
pub struct DeploymentStatus {
    #[serde(default)] pub replicas: i64,
    #[serde(default)] pub readyReplicas: i64,
    #[serde(default)] pub updatedReplicas: i64,
    #[serde(default)] pub availableReplicas: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DeploymentView {
    pub name: String, pub namespace: String,
    pub ready: String, pub updated: String,
    pub replicas: i64, pub available: i64,
    pub age: String, pub images: Vec<String>,
}

pub fn parse_deployment_list(json: &[u8]) -> std::io::Result<Vec<DeploymentView>> {
    let list: DeploymentList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let now = Utc::now();
    let mut out = Vec::with_capacity(list.items.len());
    for d in list.items {
        let desired = d.spec.replicas.unwrap_or(1);
        let ready = d.status.readyReplicas;
        let updated = d.status.updatedReplicas;
        let available = d.status.availableReplicas;
        let age = age_string(&d.metadata.creationTimestamp, now);
        let mut images: Vec<String> = d.spec.template.spec.containers.iter()
            .map(|c| c.image.clone())
            .filter(|s| !s.is_empty())
            .collect();
        // dedup + sort
        let mut seen = HashSet::new();
        images.retain(|s| seen.insert(s.clone()));
        images.sort();
        out.push(DeploymentView {
            name: d.metadata.name,
            namespace: d.metadata.namespace,
            ready: format!("{}/{}", ready, desired),
            updated: format!("{}/{}", updated, desired),
            replicas: desired,
            available,
            age,
            images,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Pod-configmap-refs parser
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
struct PodConfigMapSpec {
    #[serde(default)] pub containers: Vec<PodConfigContainer>,
    #[serde(default)] pub initContainers: Vec<PodConfigContainer>,
    #[serde(default)] pub volumes: Vec<PodConfigVolume>,
}
#[derive(Debug, Clone, Default, Deserialize)]
struct PodConfigContainer {
    #[serde(default)] pub envFrom: Vec<EnvFrom>,
    #[serde(default)] pub env: Vec<EnvVar>,
}
#[derive(Debug, Clone, Default, Deserialize)] struct EnvFrom { #[serde(default)] pub configMapRef: Option<NamedRef> }
#[derive(Debug, Clone, Default, Deserialize)] struct EnvVar { #[serde(default)] pub valueFrom: Option<ValueFrom> }
#[derive(Debug, Clone, Default, Deserialize)] struct ValueFrom { #[serde(default)] pub configMapKeyRef: Option<NamedRef> }
#[derive(Debug, Clone, Default, Deserialize)] struct NamedRef { #[serde(default)] pub name: Option<String> }
#[derive(Debug, Clone, Default, Deserialize)] struct PodConfigVolume { #[serde(default)] pub configMap: Option<NamedRef> }

#[derive(Debug, Clone, Deserialize)]
struct PodForRefs { pub spec: PodConfigMapSpec }

pub fn parse_pod_configmap_refs(json: &[u8]) -> std::io::Result<Vec<String>> {
    let pod: PodForRefs = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let mut names = HashSet::new();
    for c in pod.spec.containers.iter().chain(pod.spec.initContainers.iter()) {
        for ef in &c.envFrom {
            if let Some(nr) = &ef.configMapRef {
                if let Some(n) = &nr.name { names.insert(n.clone()); }
            }
        }
        for ev in &c.env {
            if let Some(vf) = &ev.valueFrom {
                if let Some(nr) = &vf.configMapKeyRef {
                    if let Some(n) = &nr.name { names.insert(n.clone()); }
                }
            }
        }
    }
    for v in &pod.spec.volumes {
        if let Some(nr) = &v.configMap {
            if let Some(n) = &nr.name { names.insert(n.clone()); }
        }
    }
    let mut out: Vec<String> = names.into_iter().collect();
    out.sort();
    Ok(out)
}

// ---------------------------------------------------------------------------
// Node parser
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct NodeList { pub items: Vec<NodeItem> }

#[derive(Debug, Clone, Deserialize)]
pub struct NodeItem {
    pub metadata: NodeMeta,
    #[serde(default)] pub status: NodeStatus,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NodeMeta {
    pub name: String,
    #[serde(default)] pub labels: BTreeMap<String, String>,
    pub creationTimestamp: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct NodeStatus {
    #[serde(default)] pub nodeInfo: Option<NodeInfo>,
    #[serde(default)] pub conditions: Vec<NodeCondition>,
    #[serde(default)] #[allow(dead_code)] pub capacity: BTreeMap<String, String>,
    #[serde(default)] pub allocatable: BTreeMap<String, String>,
    #[serde(default)] pub addresses: Vec<NodeAddress>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct NodeInfo {
    #[serde(default)] pub kubeletVersion: Option<String>,
    #[serde(default)] pub operatingSystem: Option<String>,
    #[serde(default)] pub architecture: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NodeCondition {
    #[serde(rename = "type")] pub type_: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NodeAddress {
    #[serde(rename = "type")] pub type_: String,
    pub address: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NodeView {
    pub name: String,
    pub ready: bool,
    pub status: String,
    pub roles: Vec<String>,
    pub version: String,
    pub os: String,
    pub internal_ip: String,
    pub age: String,
    pub pressure: Vec<String>,
    pub cpu_allocatable: String,
    pub mem_allocatable: String,
}

pub fn parse_node_list(json: &[u8]) -> std::io::Result<Vec<NodeView>> {
    let list: NodeList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let now = Utc::now();
    let mut out = Vec::with_capacity(list.items.len());
    for n in list.items {
        let ready = n.status.conditions.iter()
            .find(|c| c.type_ == "Ready")
            .map(|c| c.status == "True")
            .unwrap_or(false);
        let status = if ready { "Ready" } else { "NotReady" }.to_string();
        // roles from labels: node-role.kubernetes.io/<role>
        let mut roles: Vec<String> = n.metadata.labels.keys()
            .filter_map(|k| k.strip_prefix("node-role.kubernetes.io/").map(|s| s.to_string()))
            .filter(|s| !s.is_empty())
            .collect();
        roles.sort();
        roles.dedup();
        // pressure: MemoryPressure / PIDPressure / DiskPressure with status=="True"
        let mut pressure: Vec<String> = n.status.conditions.iter()
            .filter(|c| matches!(c.type_.as_str(), "MemoryPressure" | "PIDPressure" | "DiskPressure") && c.status == "True")
            .map(|c| c.type_.clone())
            .collect();
        pressure.sort();
        pressure.dedup();
        let internal_ip = n.status.addresses.iter()
            .find(|a| a.type_ == "InternalIP")
            .map(|a| a.address.clone())
            .unwrap_or_default();
        let version = n.status.nodeInfo.as_ref()
            .and_then(|i| i.kubeletVersion.clone())
            .unwrap_or_default();
        let os = match (n.status.nodeInfo.as_ref(), n.status.nodeInfo.as_ref()) {
            (Some(info), _) => {
                let os_str = info.operatingSystem.as_deref().unwrap_or("");
                let arch_str = info.architecture.as_deref().unwrap_or("");
                if os_str.is_empty() && arch_str.is_empty() {
                    String::new()
                } else {
                    format!("{}/{}", os_str, arch_str)
                }
            }
            _ => String::new(),
        };
        let cpu_allocatable = n.status.allocatable.get("cpu").cloned().unwrap_or_default();
        let mem_allocatable = n.status.allocatable.get("memory").cloned().unwrap_or_default();
        let age = age_string(&n.metadata.creationTimestamp, now);
        out.push(NodeView {
            name: n.metadata.name,
            ready,
            status,
            roles,
            version,
            os,
            internal_ip,
            age,
            pressure,
            cpu_allocatable,
            mem_allocatable,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// ReplicaSet / rollout history parser
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ReplicaSetList { pub items: Vec<ReplicaSetItem> }

#[derive(Debug, Clone, Deserialize)]
pub struct ReplicaSetItem {
    pub metadata: ReplicaSetMeta,
    #[serde(default)] pub spec: ReplicaSetSpec,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct ReplicaSetMeta {
    pub name: String,
    pub creationTimestamp: String,
    #[serde(default)] pub ownerReferences: Vec<OwnerRef>,
    #[serde(default)] pub annotations: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OwnerRef {
    #[serde(default)] pub kind: Option<String>,
    #[serde(default)] pub name: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ReplicaSetSpec { #[serde(default)] pub template: RsTemplate }

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RsTemplate { #[serde(default)] pub spec: RsTemplateSpec }

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RsTemplateSpec { #[serde(default)] pub containers: Vec<RsContainer> }

#[derive(Debug, Clone, Deserialize)]
pub struct RsContainer { pub image: String }

#[derive(Debug, Clone, serde::Serialize)]
pub struct RolloutRevisionView {
    pub revision: String,
    pub image: String,
    pub created: String,
    pub change_cause: String,
}

/// Parse `kubectl get rs -n <ns> -o json` into rollout revisions of `deploy_name`.
/// Keeps only ReplicaSets whose ownerReferences include kind=Deployment name=deploy_name
/// AND that have the revision annotation. Sorts by revision DESCENDING (newest first).
pub fn parse_rollout_revisions(json: &[u8], deploy_name: &str) -> std::io::Result<Vec<RolloutRevisionView>> {
    let list: ReplicaSetList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let now = Utc::now();
    let mut out: Vec<RolloutRevisionView> = list.items.into_iter()
        .filter_map(|rs| {
            let owned = rs.metadata.ownerReferences.iter().any(|o| {
                o.kind.as_deref() == Some("Deployment") && o.name.as_deref() == Some(deploy_name)
            });
            if !owned { return None; }
            let revision = rs.metadata.annotations.get("deployment.kubernetes.io/revision")?.clone();
            let image = rs.spec.template.spec.containers.iter()
                .map(|c| c.image.clone()).collect::<Vec<_>>().join(", ");
            let created = age_string(&rs.metadata.creationTimestamp, now);
            let change_cause = rs.metadata.annotations.get("kubernetes.io/change-cause")
                .cloned().unwrap_or_default();
            Some(RolloutRevisionView { revision, image, created, change_cause })
        })
        .collect();
    out.sort_by(|a, b| b.revision.cmp(&a.revision));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Watch event parser (live stream — compact NDJSON)
// ---------------------------------------------------------------------------

/// A single line from `kubectl get --raw '...?watch=true&resourceVersion=0'`.
/// Compact NDJSON: `{"type":"ADDED","object":{<Event>}}`.
#[derive(Debug, Clone, Deserialize)]
pub struct WatchEvent {
    #[serde(default, rename = "type")]
    #[allow(dead_code)]
    pub type_: Option<String>,   // "ADDED"|"MODIFIED"|"DELETED" — unused by the view, but parsed
    pub object: EventItem,        // reuse the existing EventItem
}

/// Parse one NDJSON watch line into an EventView. Returns Err on malformed JSON
/// (the caller skips Err lines — a partial line is not yet a complete record).
pub fn parse_watch_event_line(json: &[u8]) -> std::io::Result<EventView> {
    let we: WatchEvent = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(EventView {
        last_timestamp: we.object.lastTimestamp.unwrap_or_default(),
        type_: we.object.type_.unwrap_or_default(),
        reason: we.object.reason.unwrap_or_default(),
        message: we.object.message.unwrap_or_default(),
        involved_name: we.object.involvedObject.and_then(|o| o.name).unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_two_pods_with_status_and_ready() {
        let json = br#"{
            "items": [
                {"metadata":{"name":"nginx","namespace":"default","creationTimestamp":"2024-01-01T00:00:00Z"},
                 "spec":{"containers":[{"name":"nginx"}],"nodeName":"node-1"},
                 "status":{"phase":"Running","podIP":"10.0.0.1","containerStatuses":[{"name":"nginx","restartCount":0,"ready":true}]}},
                {"metadata":{"name":"crashy","namespace":"default","creationTimestamp":"2024-01-01T00:00:00Z"},
                 "spec":{"containers":[{"name":"app"}]},
                 "status":{"phase":"Running","podIP":"10.0.0.2","containerStatuses":[{"name":"app","restartCount":7,"ready":false,"state":{"waiting":{"reason":"CrashLoopBackOff"}}}]}}
            ]
        }"#;
        let views = parse_pod_list(json).unwrap();
        assert_eq!(views.len(), 2);
        let n = views.iter().find(|v| v.name == "nginx").unwrap();
        assert_eq!(n.ready, "1/1");
        assert_eq!(n.status, "Running");
        assert_eq!(n.node, "node-1");
        let c = views.iter().find(|v| v.name == "crashy").unwrap();
        assert_eq!(c.status, "CrashLoopBackOff");
        assert_eq!(c.restarts, 7);
        assert_eq!(c.ready, "0/1");
    }

    #[test]
    fn parses_container_images_from_pod_status() {
        let json = br#"{
            "items": [
                {"metadata":{"name":"nginx","namespace":"default","creationTimestamp":"2024-01-01T00:00:00Z"},
                 "spec":{"containers":[{"name":"nginx"}],"nodeName":"node-1"},
                 "status":{"phase":"Running","podIP":"10.0.0.1",
                    "containerStatuses":[{"name":"nginx","restartCount":0,"ready":true,
                        "image":"nginx:1.25","imageID":"sha256:abcdef123456"}]}}
            ]
        }"#;
        let views = parse_pod_list(json).unwrap();
        assert_eq!(views.len(), 1);
        let imgs = &views[0].container_images;
        assert_eq!(imgs.len(), 1);
        assert_eq!(imgs[0].name, "nginx");
        assert_eq!(imgs[0].image, "nginx:1.25");
        assert_eq!(imgs[0].image_id, "sha256:abcdef123456");
    }

    #[test]
    fn parses_configmap_list_with_and_without_data() {
        let json = br#"{
            "items": [
                {"metadata":{"name":"cm-with-data"},"data":{"A":"1","B":"2"}},
                {"metadata":{"name":"cm-empty"}}
            ]
        }"#;
        let views = parse_configmap_list(json).unwrap();
        assert_eq!(views.len(), 2);
        let d = views.iter().find(|v| v.name == "cm-with-data").unwrap();
        assert_eq!(d.keys, vec!["A", "B"]);
        let e = views.iter().find(|v| v.name == "cm-empty").unwrap();
        assert!(e.keys.is_empty());
    }

    #[test]
    fn parses_event_list_sorted_newest_first() {
        let json = br#"{
            "items": [
                {"lastTimestamp":"2024-01-01T10:00:00Z","type":"Normal","reason":"Started","message":"pod started","involvedObject":{"name":"nginx"}},
                {"lastTimestamp":"2024-01-01T12:00:00Z","type":"Warning","reason":"BackOff","message":"backoff","involvedObject":{"name":"crashy"}}
            ]
        }"#;
        let views = parse_event_list(json).unwrap();
        assert_eq!(views.len(), 2);
        // newest first → 12:00 then 10:00
        assert_eq!(views[0].last_timestamp, "2024-01-01T12:00:00Z");
        assert_eq!(views[0].type_, "Warning");
        assert_eq!(views[0].reason, "BackOff");
        assert_eq!(views[0].involved_name, "crashy");
        assert_eq!(views[1].last_timestamp, "2024-01-01T10:00:00Z");
        assert_eq!(views[1].involved_name, "nginx");
    }

    #[test]
    fn parses_deployment_list_ready_images() {
        let json = br#"{
            "items": [
                {"metadata":{"name":"web","namespace":"default","creationTimestamp":"2024-01-01T00:00:00Z"},
                 "spec":{"replicas":3,"template":{"spec":{"containers":[{"name":"web","image":"nginx:1.25"}]}}},
                 "status":{"replicas":3,"readyReplicas":2,"updatedReplicas":3,"availableReplicas":2}},
                {"metadata":{"name":"api","namespace":"prod","creationTimestamp":"2024-01-01T00:00:00Z"},
                 "spec":{"replicas":1,"template":{"spec":{"containers":[
                    {"name":"a","image":"a:v1"},{"name":"b","image":"a:v1"},{"name":"c","image":"b:v2"}
                 ]}}}}
            ]
        }"#;
        let views = parse_deployment_list(json).unwrap();
        assert_eq!(views.len(), 2);
        let web = views.iter().find(|v| v.name == "web").unwrap();
        assert_eq!(web.namespace, "default");
        assert_eq!(web.ready, "2/3");
        assert_eq!(web.updated, "3/3");
        assert_eq!(web.replicas, 3);
        assert_eq!(web.available, 2);
        assert!(!web.age.is_empty());
        assert_eq!(web.images, vec!["nginx:1.25"]);
        let api = views.iter().find(|v| v.name == "api").unwrap();
        assert_eq!(api.namespace, "prod");
        assert_eq!(api.ready, "0/1");
        assert_eq!(api.updated, "0/1");
        assert_eq!(api.replicas, 1);
        assert_eq!(api.available, 0);
        assert_eq!(api.images, vec!["a:v1", "b:v2"]);
    }

    #[test]
    fn parses_pod_configmap_refs_deduped_sorted() {
        let json = br#"{
            "spec": {
                "containers": [{
                    "name": "app",
                    "envFrom": [{"configMapRef": {"name": "cm-a"}}],
                    "env": [{"name": "FOO", "valueFrom": {"configMapKeyRef": {"name": "cm-b"}}}]
                }],
                "initContainers": [],
                "volumes": [{"name": "vol", "configMap": {"name": "cm-a"}}]
            }
        }"#;
        let refs = parse_pod_configmap_refs(json).unwrap();
        assert_eq!(refs, vec!["cm-a", "cm-b"]);
    }

    #[test]
    fn parses_namespace_list_names() {
        let json = br#"{
            "items": [
                {"metadata":{"name":"arc-system"}},
                {"metadata":{"name":"default"}}
            ]
        }"#;
        let names = parse_namespace_list(json).unwrap();
        assert_eq!(names.len(), 2);
        assert_eq!(names[0], "arc-system");
        assert_eq!(names[1], "default");
    }

    #[test]
    fn parses_configmap_data_returns_sorted_entries() {
        let json = br#"{
            "metadata": {"name": "my-cm"},
            "data": {"Z": "zv", "A": "av"}
        }"#;
        let view = parse_configmap_data(json).unwrap();
        assert_eq!(view.name, "my-cm");
        assert_eq!(view.entries.len(), 2);
        // BTreeMap sorts by key → A before Z
        assert_eq!(view.entries[0].key, "A");
        assert_eq!(view.entries[0].value, "av");
        assert_eq!(view.entries[1].key, "Z");
        assert_eq!(view.entries[1].value, "zv");
    }

    #[test]
    fn parses_configmap_data_no_data_field_empty_entries() {
        let json = br#"{
            "metadata": {"name": "empty-cm"}
        }"#;
        let view = parse_configmap_data(json).unwrap();
        assert_eq!(view.name, "empty-cm");
        assert!(view.entries.is_empty());
    }

    #[test]
    fn parses_rollout_revisions_filters_and_sorts() {
        let json = br#"{
            "items": [
                {"metadata":{"name":"web-abc","creationTimestamp":"2026-09-01T00:00:00Z",
                    "ownerReferences":[{"kind":"Deployment","name":"skillhub-backend"}],
                    "annotations":{"deployment.kubernetes.io/revision":"11"}},
                 "spec":{"template":{"spec":{"containers":[{"image":"skillhub:v2"}]}}}},
                {"metadata":{"name":"web-xyz","creationTimestamp":"2026-09-02T00:00:00Z",
                    "ownerReferences":[{"kind":"Deployment","name":"skillhub-backend"}],
                    "annotations":{"deployment.kubernetes.io/revision":"10","kubernetes.io/change-cause":"kubectl rollout restart"}},
                 "spec":{"template":{"spec":{"containers":[{"image":"skillhub:v1"}]}}}},
                {"metadata":{"name":"other-rs","creationTimestamp":"2026-09-01T00:00:00Z",
                    "ownerReferences":[{"kind":"Deployment","name":"OTHER-deploy"}],
                    "annotations":{"deployment.kubernetes.io/revision":"5"}},
                 "spec":{"template":{"spec":{"containers":[{"image":"other:v9"}]}}}}
            ]
        }"#;
        let views = parse_rollout_revisions(json, "skillhub-backend").unwrap();
        assert_eq!(views.len(), 2, "should filter to RSs owned by skillhub-backend");
        // newest first: revision 11 then 10
        assert_eq!(views[0].revision, "11");
        assert_eq!(views[0].image, "skillhub:v2");
        assert!(!views[0].created.is_empty(), "created age should be non-empty");
        assert_eq!(views[0].change_cause, "");
        assert_eq!(views[1].revision, "10");
        assert_eq!(views[1].image, "skillhub:v1");
        assert_eq!(views[1].change_cause, "kubectl rollout restart");
    }

    #[test]
    fn parses_watch_event_line_into_eventview() {
        let line = br#"{"type":"ADDED","object":{"lastTimestamp":"2026-01-01T10:00:00Z","type":"Warning","reason":"BackOff","message":"back-off","involvedObject":{"name":"pod-x"}}}"#;
        let ev = parse_watch_event_line(line).unwrap();
        assert_eq!(ev.last_timestamp, "2026-01-01T10:00:00Z");
        assert_eq!(ev.type_, "Warning");
        assert_eq!(ev.reason, "BackOff");
        assert_eq!(ev.message, "back-off");
        assert_eq!(ev.involved_name, "pod-x");
    }

    #[test]
    fn parses_watch_event_line_missing_optional_fields_returns_empty_strings() {
        // No lastTimestamp, type, reason, message, or involvedObject — should not error
        let line = br#"{"type":"ADDED","object":{}}"#;
        let ev = parse_watch_event_line(line).unwrap();
        assert_eq!(ev.last_timestamp, "");
        assert_eq!(ev.type_, "");
        assert_eq!(ev.reason, "");
        assert_eq!(ev.message, "");
        assert_eq!(ev.involved_name, "");
    }

    #[test]
    fn parses_node_list_ready_pressure_roles() {
        let json = br#"{
            "items": [
                {
                    "metadata": {
                        "name": "control-node",
                        "labels": {"node-role.kubernetes.io/control-plane": ""},
                        "creationTimestamp": "2024-01-01T00:00:00Z"
                    },
                    "status": {
                        "nodeInfo": {"kubeletVersion": "v1.30.0", "operatingSystem": "linux", "architecture": "amd64"},
                        "conditions": [
                            {"type": "Ready", "status": "True"},
                            {"type": "MemoryPressure", "status": "False"},
                            {"type": "PIDPressure", "status": "False"},
                            {"type": "DiskPressure", "status": "False"}
                        ],
                        "capacity": {"cpu": "8", "memory": "32Gi", "pods": "110"},
                        "allocatable": {"cpu": "4", "memory": "16Gi", "pods": "110"},
                        "addresses": [{"type": "InternalIP", "address": "10.0.0.5"}, {"type": "Hostname", "address": "control-node"}]
                    }
                },
                {
                    "metadata": {
                        "name": "worker-node",
                        "labels": {},
                        "creationTimestamp": "2024-01-01T00:00:00Z"
                    },
                    "status": {
                        "nodeInfo": {"kubeletVersion": "v1.29.0"},
                        "conditions": [
                            {"type": "Ready", "status": "False"},
                            {"type": "MemoryPressure", "status": "True"},
                            {"type": "PIDPressure", "status": "False"},
                            {"type": "DiskPressure", "status": "False"}
                        ],
                        "allocatable": {"cpu": "2", "memory": "8Gi"},
                        "addresses": [{"type": "InternalIP", "address": "10.0.0.6"}]
                    }
                }
            ]
        }"#;
        let views = parse_node_list(json).unwrap();
        assert_eq!(views.len(), 2);
        // Node A: control-node
        let a = views.iter().find(|v| v.name == "control-node").unwrap();
        assert_eq!(a.ready, true);
        assert_eq!(a.status, "Ready");
        assert_eq!(a.roles, vec!["control-plane"]);
        assert_eq!(a.pressure, Vec::<String>::new());
        assert_eq!(a.version, "v1.30.0");
        assert_eq!(a.os, "linux/amd64");
        assert_eq!(a.internal_ip, "10.0.0.5");
        assert_eq!(a.cpu_allocatable, "4");
        assert_eq!(a.mem_allocatable, "16Gi");
        assert!(!a.age.is_empty());
        // Node B: worker-node
        let b = views.iter().find(|v| v.name == "worker-node").unwrap();
        assert_eq!(b.ready, false);
        assert_eq!(b.status, "NotReady");
        assert_eq!(b.pressure, vec!["MemoryPressure"]);
        assert_eq!(b.roles, Vec::<String>::new());
        assert_eq!(b.version, "v1.29.0");
        assert_eq!(b.internal_ip, "10.0.0.6");
        assert_eq!(b.cpu_allocatable, "2");
        assert_eq!(b.mem_allocatable, "8Gi");
    }
}
