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

pub fn parse_configmap_list(json: &[u8]) -> std::io::Result<Vec<ConfigMapView>> {
    let list: ConfigMapList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(list.items.into_iter().map(|cm| ConfigMapView {
        name: cm.metadata.name,
        keys: cm.data.keys().cloned().collect(),
    }).collect())
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
}
