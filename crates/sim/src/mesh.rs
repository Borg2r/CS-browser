//! Collision against an imported triangle world. The immutable BVH is shared by
//! native simulation and WASM prediction; render and collision use identical vertices.
use crate::V3;

const SKIN: f32 = 0.001;
const WALKABLE_Y: f32 = 0.65;

#[derive(Clone, Copy, Debug)]
pub struct MeshHit {
    /// Fraction of the requested translation before contact.
    pub fraction: f32,
    pub normal: V3,
}

#[derive(Clone, Copy, Debug)]
pub struct MeshRayHit {
    pub distance: f32,
    pub normal: V3,
}

struct Triangle {
    vertices: [V3; 3],
    min: V3,
    max: V3,
    normal: V3,
}

struct Node {
    min: V3,
    max: V3,
    start: usize,
    end: usize,
    children: Option<[usize; 2]>,
}

pub struct CollisionMesh {
    triangles: Vec<Triangle>,
    nodes: Vec<Node>,
}

fn sub(a: V3, b: V3) -> V3 { [a[0]-b[0], a[1]-b[1], a[2]-b[2]] }
fn dot(a: V3, b: V3) -> f32 { a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
fn cross(a: V3, b: V3) -> V3 {
    [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
}
fn boxes_overlap(a: V3, b: V3, c: V3, d: V3) -> bool {
    (0..3).all(|i| a[i] <= d[i] && b[i] >= c[i])
}

impl Triangle {
    fn new(vertices: [V3; 3]) -> Option<Self> {
        let n = cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0]));
        let len = dot(n,n).sqrt();
        if len < 1e-7 { return None; }
        let min = std::array::from_fn(|i| vertices.iter().map(|v| v[i]).fold(f32::INFINITY,f32::min));
        let max = std::array::from_fn(|i| vertices.iter().map(|v| v[i]).fold(f32::NEG_INFINITY,f32::max));
        Some(Self { vertices, min, max, normal: n.map(|v| v/len) })
    }

    fn axes(&self) -> [V3; 13] {
        let edges = [sub(self.vertices[1], self.vertices[0]), sub(self.vertices[2], self.vertices[1]), sub(self.vertices[0], self.vertices[2])];
        let mut axes = [[0.0;3];13];
        axes[0]=[1.0,0.0,0.0]; axes[1]=[0.0,1.0,0.0]; axes[2]=[0.0,0.0,1.0];
        axes[3]=self.normal;
        for (i,e) in edges.into_iter().enumerate() {
            axes[4+i*3]=[0.0,e[2],-e[1]];
            axes[5+i*3]=[-e[2],0.0,e[0]];
            axes[6+i*3]=[e[1],-e[0],0.0];
        }
        axes
    }

    fn projection(&self, axis: V3) -> (f32,f32) {
        let p=self.vertices.map(|v| dot(v,axis));
        (p[0].min(p[1]).min(p[2]),p[0].max(p[1]).max(p[2]))
    }

    fn overlaps(&self, center: V3, half: V3) -> bool {
        for axis in self.axes() {
            if dot(axis,axis)<1e-12 { continue; }
            let (lo,hi)=self.projection(axis);
            let p=dot(center,axis);
            let radius=dot(half,axis.map(f32::abs));
            if p+radius<=lo || p-radius>=hi { return false; }
        }
        true
    }

    /// Continuous separating-axis test: a translating box cannot tunnel through
    /// thin walls, railings or a stair riser even when its endpoint is clear.
    fn sweep(&self, center: V3, half: V3, delta: V3) -> Option<MeshHit> {
        let mut enter=f32::NEG_INFINITY;
        let mut exit=f32::INFINITY;
        let mut normal=[0.0;3];
        for axis in self.axes() {
            let len2=dot(axis,axis);
            if len2<1e-12 { continue; }
            let (lo,hi)=self.projection(axis);
            let p=dot(center,axis);
            let radius=dot(half,axis.map(f32::abs));
            let speed=dot(delta,axis);
            if speed.abs()<1e-9 {
                if p+radius<=lo || p-radius>=hi { return None; }
                continue;
            }
            let a=(lo-radius-p)/speed;
            let b=(hi+radius-p)/speed;
            let t0=a.min(b);
            let t1=a.max(b);
            if t0>enter {
                enter=t0;
                let sign=if speed>0.0 {-1.0} else {1.0};
                normal=axis.map(|v|v*sign/len2.sqrt());
            }
            exit=exit.min(t1);
            if enter>exit { return None; }
        }
        // Already touching and moving away must not pin a player to a surface.
        if enter < -1e-5 || enter>1.0 || exit<0.0 { return None; }
        Some(MeshHit { fraction: enter.max(0.0), normal })
    }

    fn ray(&self, origin: V3, direction: V3, max_t: f32) -> Option<f32> {
        let e1=sub(self.vertices[1],self.vertices[0]);
        let e2=sub(self.vertices[2],self.vertices[0]);
        let p=cross(direction,e2);
        let determinant=dot(e1,p);
        if determinant.abs()<1e-8 { return None; }
        let inv=1.0/determinant;
        let t=sub(origin,self.vertices[0]);
        let u=dot(t,p)*inv;
        if !(-1e-6..=1.000001).contains(&u) { return None; }
        let q=cross(t,e1);
        let v=dot(direction,q)*inv;
        if v < -1e-6 || u+v>1.000001 { return None; }
        let distance=dot(e2,q)*inv;
        (distance>=0.0 && distance<=max_t).then_some(distance)
    }

    // Maximum floor height beneath a square footprint, clipping the actual
    // triangle rather than its bounding box (essential around diagonal ramps).
    fn support_height(&self, x: f32,z: f32,half_width: f32)->Option<f32> {
        if self.normal[1]<WALKABLE_Y { return None; }
        let mut polygon=self.vertices.to_vec();
        for (axis,edge,sign) in [(0,x-half_width,1.0),(0,x+half_width,-1.0),(2,z-half_width,1.0),(2,z+half_width,-1.0)] {
            if polygon.is_empty() { return None; }
            let mut next=Vec::with_capacity(8);
            let mut a=*polygon.last().unwrap();
            let mut da=(a[axis]-edge)*sign;
            for &b in &polygon {
                let db=(b[axis]-edge)*sign;
                if (da>=0.0)!=(db>=0.0) {
                    let t=da/(da-db);
                    next.push(std::array::from_fn(|i|a[i]+(b[i]-a[i])*t));
                }
                if db>=0.0 { next.push(b); }
                a=b; da=db;
            }
            polygon=next;
        }
        polygon.into_iter().map(|p|p[1]).reduce(f32::max)
    }
}

impl CollisionMesh {
    /// Consecutive little-endian f32 xyz vertices, three vertices per triangle.
    pub fn from_bytes(data: &[u8]) -> Self {
        assert!(!data.is_empty() && data.len()%36==0,"invalid collision mesh");
        let triangles=data.chunks_exact(36).filter_map(|bytes| {
            let vertices=std::array::from_fn(|v|std::array::from_fn(|a| {
                let i=(v*3+a)*4;
                f32::from_le_bytes(bytes[i..i+4].try_into().unwrap())
            }));
            assert!(vertices.iter().flatten().all(|v|v.is_finite()));
            Triangle::new(vertices)
        }).collect();
        let mut mesh=Self{triangles,nodes:Vec::new()};
        assert!(!mesh.triangles.is_empty());
        mesh.build_node(0,mesh.triangles.len());
        mesh
    }

    fn build_node(&mut self,start:usize,end:usize)->usize {
        let min=std::array::from_fn(|i|self.triangles[start..end].iter().map(|t|t.min[i]).fold(f32::INFINITY,f32::min));
        let max=std::array::from_fn(|i|self.triangles[start..end].iter().map(|t|t.max[i]).fold(f32::NEG_INFINITY,f32::max));
        let index=self.nodes.len();
        self.nodes.push(Node{min,max,start,end,children:None});
        if end-start>8 {
            let axis=(0..3).max_by(|&a,&b|(max[a]-min[a]).total_cmp(&(max[b]-min[b]))).unwrap();
            self.triangles[start..end].sort_unstable_by(|a,b| (a.min[axis]+a.max[axis]).total_cmp(&(b.min[axis]+b.max[axis])));
            let mid=(start+end)/2;
            let left=self.build_node(start,mid);
            let right=self.build_node(mid,end);
            self.nodes[index].children=Some([left,right]);
        }
        index
    }

    fn visit_box(&self,index:usize,min:V3,max:V3,f:&mut impl FnMut(&Triangle)) {
        let node=&self.nodes[index];
        if !boxes_overlap(min,max,node.min,node.max) { return; }
        if let Some(children)=node.children {
            for child in children { self.visit_box(child,min,max,f); }
        } else {
            for t in &self.triangles[node.start..node.end] {
                if boxes_overlap(min,max,t.min,t.max) { f(t); }
            }
        }
    }

    pub fn overlaps_box(&self,min:V3,max:V3)->bool {
        let center=std::array::from_fn(|i|(min[i]+max[i])*0.5);
        let half=std::array::from_fn(|i|((max[i]-min[i])*0.5-SKIN*0.2).max(0.0));
        let mut hit=false;
        self.visit_box(0,min,max,&mut |t| { if !hit && t.overlaps(center,half) { hit=true; } });
        hit
    }

    pub fn sweep_box(&self,pos:V3,delta:V3,half_width:f32,height:f32)->Option<MeshHit> {
        let center=[pos[0],pos[1]+height*0.5,pos[2]];
        let half=[half_width,height*0.5,half_width];
        let min=std::array::from_fn(|i|center[i]+delta[i].min(0.0)-half[i]);
        let max=std::array::from_fn(|i|center[i]+delta[i].max(0.0)+half[i]);
        let mut best:Option<MeshHit>=None;
        self.visit_box(0,min,max,&mut |t| {
            if let Some(hit)=t.sweep(center,half,delta) {
                if best.is_none_or(|b|hit.fraction<b.fraction) { best=Some(hit); }
            }
        });
        best
    }

    pub fn raycast(&self,origin:&V3,direction:&V3,max_t:f32)->Option<MeshRayHit> {
        let mut best:Option<MeshRayHit>=None;
        let mut stack=vec![0];
        while let Some(index)=stack.pop() {
            let node=&self.nodes[index];
            let limit=best.map_or(max_t,|h|h.distance);
            if crate::physics::ray_aabb(origin,direction,&node.min,&node.max).is_none_or(|t|t>limit) { continue; }
            if let Some(children)=node.children { stack.extend(children); }
            else {
                for triangle in &self.triangles[node.start..node.end] {
                    if let Some(distance)=triangle.ray(*origin,*direction,best.map_or(max_t,|h|h.distance)) {
                        best=Some(MeshRayHit{distance,normal:triangle.normal});
                    }
                }
            }
        }
        best
    }

    /// All walkable surfaces at a point, lower to upper. Ceilings are excluded.
    pub fn floor_heights(&self,x:f32,z:f32)->Vec<f32> {
        let min=[x,f32::NEG_INFINITY,z];
        let max=[x,f32::INFINITY,z];
        let top=self.nodes[0].max[1]+1.0;
        let mut heights=Vec::new();
        self.visit_box(0,min,max,&mut |t| {
            if t.normal[1]>=WALKABLE_Y {
                if let Some(distance)=t.ray([x,top,z],[0.0,-1.0,0.0],f32::MAX) { heights.push(top-distance); }
            }
        });
        heights.sort_by(f32::total_cmp);
        heights.dedup_by(|a,b|(*a-*b).abs()<0.002);
        heights
    }

    /// Highest floor inside an explicit height interval; never chooses a roof
    /// above a player who is walking through the tunnel beneath it.
    pub fn floor_height(&self,x:f32,z:f32,near_y:f32,max_up:f32,max_down:f32)->Option<f32> {
        self.floor_heights(x,z).into_iter().rev().find(|&y|y<=near_y+max_up+0.002 && y>=near_y-max_down-0.002)
    }

    /// Highest usable support for an entire player footprint in the given
    /// interval. Use this for spawn placement and slope-aware navigation.
    pub fn standing_height(&self,x:f32,z:f32,near_y:f32,max_up:f32,max_down:f32,half_width:f32,height:f32)->Option<f32> {
        let mut candidates=Vec::new();
        let min=[x-half_width,near_y-max_down-0.002,z-half_width];
        let max=[x+half_width,near_y+max_up+0.002,z+half_width];
        self.visit_box(0,min,max,&mut |t| {
            if let Some(y)=t.support_height(x,z,half_width) {
                if y<=max[1] && y>=min[1] { candidates.push(y); }
            }
        });
        candidates.sort_by(|a,b|b.total_cmp(a));
        candidates.dedup_by(|a,b|(*a-*b).abs()<0.002);
        candidates.into_iter().find(|&y|!self.overlaps_box([x-half_width,y+SKIN,z-half_width],[x+half_width,y+height+SKIN,z+half_width]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mesh(triangles:&[[V3;3]])->CollisionMesh {
        let bytes:Vec<u8>=triangles.iter().flatten().flatten().flat_map(|v|v.to_le_bytes()).collect();
        CollisionMesh::from_bytes(&bytes)
    }

    #[test]
    fn swept_player_cannot_tunnel_through_a_zero_thickness_wall() {
        let m=mesh(&[[[0.0,-2.0,-3.0],[0.0,5.0,-3.0],[0.0,5.0,3.0]],[[0.0,-2.0,-3.0],[0.0,5.0,3.0],[0.0,-2.0,3.0]]]);
        let hit=m.sweep_box([-2.0,0.0,0.0],[4.0,0.0,0.0],0.4,1.8).unwrap();
        assert!((hit.fraction-0.4).abs()<1e-5);
        assert_eq!(hit.normal,[-1.0,0.0,0.0]);
        assert!(m.overlaps_box([-0.2,0.0,-0.2],[0.2,1.8,0.2]));
        assert!(!m.overlaps_box([-1.0,0.0,-0.2],[-0.6,1.8,0.2]));
    }

    #[test]
    fn triangle_rays_and_footprints_do_not_fill_in_diagonal_empty_space() {
        let m=mesh(&[[[0.0,0.0,0.0],[0.0,0.0,4.0],[4.0,0.0,0.0]]]);
        assert_eq!(m.floor_heights(1.0,1.0),vec![0.0]);
        assert!(m.floor_heights(3.0,3.0).is_empty());
        assert!(m.raycast(&[3.0,2.0,3.0],&[0.0,-1.0,0.0],10.0).is_none());
        assert!(m.sweep_box([3.0,1.0,3.0],[0.0,-2.0,0.0],0.4,1.8).is_none());
    }

    #[test]
    fn ground_queries_keep_underpasses_and_support_sloped_footprints() {
        let m=mesh(&[
            [[-4.0,0.0,-4.0],[-4.0,0.0,4.0],[4.0,0.0,-4.0]],
            [[-4.0,3.0,-4.0],[-4.0,3.0,4.0],[4.0,3.0,-4.0]],
            [[5.0,0.0,-4.0],[5.0,0.0,4.0],[9.0,2.0,-4.0]],
        ]);
        assert_eq!(m.floor_heights(-1.0,-1.0),vec![0.0,3.0]);
        assert_eq!(m.floor_height(-1.0,-1.0,0.0,0.5,0.5),Some(0.0));
        assert!((m.standing_height(6.0,-1.0,0.5,0.5,0.5,0.4,1.8).unwrap()-0.7).abs()<1e-5);
    }
}
