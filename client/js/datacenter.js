// NORD DC-02: lightweight architectural dressing for the IFC-derived map.
// Large equipment comes from the shared Rust collision layout. These details
// stay on those surfaces or above the playable space, and share instance batches.

export function datacenterTexture(g, s, type) {
  const line = (color, x, y, w, h) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
  if (type === 'ground') {
    line('#a3adae',0,0,s,s);
    for(let row=0;row<4;row++)for(let col=0;col<4;col++){
      const tile=s/4,x=col*tile,y=row*tile;
      line((row+col)%3===0?'#b4bdbb':'#aeb6b5',x+1,y+1,tile-2,tile-2);
      line('#d1d6d2',x+2,y+2,tile-4,1);
    }
    for(let i=0;i<1800;i++)line(i%2?'#9ba5a430':'#eff4ee24',(i*137)%s,(i*73)%s,1,1);
  } else if(type==='wall') {
    line('#dce2df',0,0,s,s);
    for(let x=0;x<s;x+=s/4){line('#a3b0b12c',x,0,2,s);line('#f2f6ee',x+2,0,1,s);}
    line('#c2cecb',0,s-15,s,15);line('#9aaeb0',0,s-16,s,2);
    for(let i=0;i<900;i++)line('#7a8a8b0c',(i*97)%s,(i*53)%s,1,2);
  } else if(type==='container') {
    line('#26343c',0,0,s,s);
    for(let y=4;y<s;y+=16){
      line('#46545a',7,y,s-14,12);line('#1b2b32',12,y+3,s-25,2);
      line('#16262d',12,y+7,s-25,2);line('#75cdd5',s-20,y+4,3,3);
    }
    line('#728183',0,0,4,s);line('#1b282c',s-5,0,5,s);
  } else if(type==='crate') {
    line('#c5cecb',0,0,s,s);
    for(let x=0;x<s;x+=s/2){
      line('#718487',x,0,2,s);line('#dae1da',x+3,0,2,s);
      line('#43585e',x+s/2-13,s*.3,5,s*.18);
      for(let y=s*.65;y<s*.88;y+=6)line('#86999a',x+12,y,s/2-24,2);
    }
  } else {
    line('#8c9a9c',0,0,s,s);
    for(let y=0;y<s;y+=16){line('#485e65',0,y,s,2);line('#b0bcb9',0,y+3,s,1);}
    for(let x=0;x<s;x+=32)line('#667e82',x,0,2,s);
  }
}

export function datacenterTint(mat, variant, b) {
  if(mat===0)return 0xffffff;
  if(mat===1)return b[1]>2?0xe1e8e3:[0xdbe6e5,0xd3deda,0xe6e9e1,0xd0dfe0][variant%4];
  if(mat===2)return 0xd3e1e6;
  if(mat===3)return [0xe7eeeb,0xcbd8d5,0xe4e8dd,0xc6d3d1][variant%4];
  return [0xd5e1df,0xc3d0d0,0xd3d9ce,0xaebdbf][variant%4];
}

const C={steel:0x627787,dark:0x14222d,rack:0x354958,edge:0x90a5af,
  cyan:0x25b8cc,blue:0x326ce0,red:0xcf464b,light:0xc9f2f4,warm:0xc4aa7c};

function panel(d,color,b,y0,y1,offset=.025,material='metal') {
  const [x0,,z0,x1,,z1]=b,x=(x0+x1)/2,z=(z0+z1)/2;
  d.box(color,[x,(y0+y1)/2,z0-offset],[x1-x0-.08,y1-y0,.025],material);
  d.box(color,[x,(y0+y1)/2,z1+offset],[x1-x0-.08,y1-y0,.025],material);
  d.box(color,[x0-offset,(y0+y1)/2,z],[.025,y1-y0,z1-z0-.08],material);
  d.box(color,[x1+offset,(y0+y1)/2,z],[.025,y1-y0,z1-z0-.08],material);
}

function rackDetails(d,map) {
  const racks=map.boxes.filter(b=>b[6]===2&&b[1]<.1);
  const rows=new Map();
  racks.forEach((b,index)=>{
    const [x0,,z0,x1,h,z1]=b,x=(x0+x1)/2,z=(z0+z1)/2,w=x1-x0,depth=z1-z0;
    const row=rows.get(b[7])||[];row.push(b);rows.set(b[7],row);
    // Each of the 48 source cabinets retains its own frame and numbered door.
    for(const xx of [x0+.035,x1-.035])for(const zz of [z0-.025,z1+.025])
      d.box(C.steel,[xx,h/2,zz],[.055,h,.055],'metal');
    for(const y of [.07,h-.06]){
      d.box(C.edge,[x,y,z0-.03],[w,.055,.06],'metal');
      d.box(C.edge,[x,y,z1+.03],[w,.055,.06],'metal');
    }
    for(const front of [false,true]){
      const zz=front?z1+.039:z0-.039,faceSign=front?1:-1;
      d.box(C.dark,[x,h/2,zz],[w-.13,h-.25,.035],'metal');
      for(let u=0;u<11;u++){
        const y=.21+(h-.46)*u/11;
        d.box(front?0x40515d:0x30414b,[x,y,zz+faceSign*.024],[w-.19,.13,.026],'metal');
        d.box(0x162631,[x-.05,y,zz+faceSign*.04],[w-.38,.027,.01],'metal');
        if(front){
          d.box(u%4===0?0x64daba:0x64c9e0,[x+w*.31,y+.025,zz+faceSign*.044],[.025,.022,.012],'light');
          d.box(u%5===0?0xe8b964:0x80a4a5,[x+w*.25,y+.025,zz+faceSign*.044],[.018,.018,.012],'light');
          d.box(C.edge,[x-w*.32,y,zz+faceSign*.045],[.018,.07,.015],'metal');
        }else{
          d.box(u%2?C.blue:C.cyan,[x+w*.32,y,zz+faceSign*.04],[.025,.09,.02],'paint');
        }
      }
      d.box(C.edge,[x+w*.36,1.4,zz+faceSign*.06],[.035,.32,.035],'metal');
      d.label(`R${b[7]+1} · ${String(index%12+1).padStart(2,'0')}`,'NORD  /  DC-02',
        [x,h-.2,zz+faceSign*.065],Math.min(w-.16,.9),front?0:Math.PI,'#1b3548');
    }
    d.box(C.steel,[x,h+.018,z],[w-.09,.035,depth-.12],'metal');
    for(const zz of [z0+.35,z1-.35]){
      d.cylinder(C.dark,[x,h+.04,zz],[Math.min(.62,w-.2),.035,.62]);
      d.cylinder(0x576d77,[x,h+.065,zz],[.11,.025,.11]);
    }
    // Vertical service drops are on the rear cabinet body, not in the aisle.
    for(const [dx,color]of[[-.16,C.red],[-.10,C.blue]])
      d.box(color,[x+dx,h*.75,z0-.066],[.028,h*.42,.025]);
  });
  const ordered=[...rows.values()].sort((a,b)=>a[0][2]-b[0][2]);
  ordered.forEach((row,i)=>{
    const x0=Math.min(...row.map(b=>b[0])),x1=Math.max(...row.map(b=>b[3]));
    const z0=row[0][2],z1=row[0][5],mid=(x0+x1)/2,z=(z0+z1)/2;
    // Ladder cable trays and separate A/B power feeds mirror the IFC services.
    for(const offset of [-.4,.4]){
      d.box(C.steel,[mid,3.9,z+offset],[x1-x0+.4,.07,.055],'metal');
      for(let x=x0-.15;x<=x1+.15;x+=.65)d.box(C.edge,[x,3.87,z],[.04,.045,.8],'metal');
    }
    for(const [offset,color]of[[-.23,C.red],[.02,C.blue],[.25,C.cyan]])
      d.box(color,[mid,3.94,z+offset],[x1-x0+.2,.05,.06]);
    for(const x of [x0+.6,x1-.6])for(const dz of [-.4,.4])
      d.box(C.steel,[x,4.55,z+dz],[.035,1.3,.035],'metal');
    if(i<ordered.length-1){
      const next=ordered[i+1][0][2],gap=next-z1;
      if(gap>1){
        const cold=i%2===0;
        d.box(cold?0x467d90:0x766c5c,[mid,.017,(z1+next)/2],[x1-x0+.1,.008,gap-.15]);
        for(const zz of [z1+.14,next-.14])d.box(cold?C.cyan:0xc48f53,[mid,.024,zz],[x1-x0+.1,.009,.075]);
      }
    }
  });
}

function utilityDetails(d,map) {
  for(const b of map.boxes.filter(b=>b[6]===3&&b[1]<.1)){
    const [x0,,z0,x1,h,z1,,kind]=b,x=(x0+x1)/2,z=(z0+z1)/2,w=x1-x0,depth=z1-z0;
    if(kind===2){
      panel(d,0x7d8988,b,.08,h-.07);
      for(const xx of [x0+.18,x1-.18])d.box(0x343e46,[xx,h/2,z1+.05],[.09,h,.04],'metal');
      d.box(C.warm,[x,h+.025,z],[w,.05,depth]);
      d.label('NORD / RESERVE','FUTURE CAPACITY',[x,h*.65,z1+.075],Math.min(2,w-.2),0,'#645e4e');
    }else if(kind===1&&x>-7&&z>30){
      // The source annex lounge has dining furniture rather than server desks.
      d.box(0xbea27b,[x,h+.025,z],[w+.03,.05,depth+.03]);
      for(let xx=x0+.65;xx<x1-.4;xx+=1.6){
        d.cylinder(0xd9dfd6,[xx,h+.06,z],[.34,.035,.34],'paint');
        d.cylinder(0x426172,[xx+.08,h+.14,z],[.14,.17,.14],'paint');
        d.cylinder(0x273a42,[xx+.08,h+.23,z],[.105,.012,.105],'paint');
        d.box(0x708b86,[xx,.52,z0+.15],[.65,.48,.14]);
        d.box(0x708b86,[xx,.52,z1-.15],[.65,.48,.14]);
      }
    }else if(kind===1||kind===3){
      d.box(kind===3?0x435b68:0xbca98b,[x,h+.025,z],[w+.03,.05,depth+.03]);
      for(let xx=x0+.55;xx<x1-.25;xx+=1.65){
        const facingZ=z1-.24;
        d.box(C.dark,[xx,h+.43,z],[.95,.53,.085],'metal');
        d.box(kind===3?0x33758e:0x6d939d,[xx,h+.43,z+.047],[.83,.43,.018],'light');
        d.box(C.cyan,[xx-.21,h+.47,z+.059],[.23,.25,.012],'light');
        for(let u=0;u<4;u++)d.box(0xb5d3d2,[xx+.15,h+.56-u*.075,z+.06],[.27,.012,.01],'light');
        d.box(C.steel,[xx,h+.14,z],[.08,.28,.1],'metal');
        d.box(C.dark,[xx,h+.065,facingZ],[.69,.04,.25],'metal');
      }
    }else{
      const branch=z>15?'A':'B',electrical=z<8,accent=electrical?0xb39a60:branch==='A'?C.red:C.blue;
      panel(d,0xb5c3c8,b,.12,h-.12);
      const count=Math.max(1,Math.round(w/1.2));
      for(let n=0;n<count;n++){
        const xx=x0+(n+.5)*w/count;
        for(const side of [-1,1]){
          const zz=side===1?z1+.06:z0-.06;
          d.box(C.steel,[xx-w/count*.43,h/2,zz],[.035,h-.22,.035],'metal');
          d.box(accent,[xx,h-.22,zz],[w/count-.12,.10,.03]);
          d.box(C.dark,[xx,h*.64,zz+side*.025],[Math.min(.46,w/count-.2),.3,.025],'metal');
          d.box(0x8ad6e4,[xx,h*.65,zz+side*.043],[Math.min(.32,w/count-.25),.16,.012],'light');
          d.box(C.edge,[xx+w/count*.3,h*.46,zz+side*.035],[.045,.24,.045],'metal');
          for(let y=.25;y<Math.min(.65,h*.3);y+=.085)
            d.box(C.steel,[xx,y,zz+side*.025],[w/count-.18,.025,.025],'metal');
        }
      }
      d.label(electrical?'SWITCHGEAR':`UPS ${branch}`,electrical?'POWER DISTRIBUTION':'DUAL POWER PATH',
        [x,h-.47,z1+.13],Math.min(w-.15,1.6),0,electrical?'#645739':branch==='A'?'#653746':'#274c78');
    }
  }
}

function plantDetails(d,map) {
  for(const b of map.boxes.filter(b=>b[6]===4&&b[1]<.1)){
    const [x0,,z0,x1,h,z1,,kind]=b,x=(x0+x1)/2,z=(z0+z1)/2,w=x1-x0,depth=z1-z0;
    if(kind===3){
      panel(d,0x7c949a,b,.08,Math.max(.12,h-.06));
      for(let xx=x0+.2;xx<x1-.1;xx+=.55)d.box(0xd7b554,[xx,h*.7,z1+.04],[.24,.13,.035]);
      continue;
    }
    panel(d,kind===1?0xc7d0c9:0x97adb4,b,.13,h-.14);
    for(const zz of [z0-.06,z1+.06]){
      for(let xx=x0+.2;xx<x1-.1;xx+=1.4){
        d.box(C.steel,[xx,h/2,zz],[.045,h-.22,.035],'metal');
        for(let y=.35;y<h-.3;y+=.16)d.box(0x3d5562,[xx+.55,y,zz],[Math.min(1.05,x1-xx-.2),.055,.025],'metal');
      }
      d.box(kind===1?0xa48757:C.cyan,[x,h-.18,zz],[w-.15,.13,.035]);
    }
    if(kind===0){
      for(let xx=x0+1.2;xx<x1-.6;xx+=2.4){
        const diameter=Math.min(depth-.4,1.95);
        d.cylinder(C.dark,[xx,h+.025,z],[diameter,.04,diameter]);
        d.cylinder(C.steel,[xx,h+.055,z],[.33,.045,.33]);
        for(const angle of [0,Math.PI/3,Math.PI*2/3])
          d.box(0x6d8a92,[xx,h+.06,z],[diameter*.78,.035,.095],'metal',[0,angle,0]);
      }
      d.label('CHILLED WATER','NORD  /  COOLING PLANT',[x,h*.6,z1+.12],Math.min(w-.3,3.5),0,'#285d70');
    }else if(kind===1){
      d.box(C.steel,[x,h+.035,z],[w-.15,.07,depth-.15],'metal');
      for(const xx of [x0+.8,x1-.8]){
        d.cylinder(C.dark,[xx,h+.16,z],[.24,.32,.24]);
        d.box(C.steel,[xx,h+.33,z],[.4,.06,.4],'metal');
      }
      d.label('STANDBY GENERATOR','NORD  /  POWER RESILIENCE',[x,h*.65,z1+.12],Math.min(w-.3,4.4),0,'#66563f');
    }else{
      for(const xx of [x0+w*.3,x0+w*.7]){
        d.cylinder(C.blue,[xx,h*.55,z],[.48,h*.65,.48]);
        d.box(C.cyan,[xx,h*.82,z],[.8,.10,.1]);
      }
    }
  }
}

function floor(d,x0,z0,x1,z1,color,grid=false){
  d.box(color,[(x0+x1)/2,.008,(z0+z1)/2],[x1-x0,.012,z1-z0]);
  if(grid){
    for(let x=x0+1.2;x<x1;x+=1.2)d.box(0x87999e,[x,.016,(z0+z1)/2],[.012,.006,z1-z0]);
    for(let z=z0+1.2;z<z1;z+=1.2)d.box(0x87999e,[(x0+x1)/2,.016,z],[x1-x0,.006,.012]);
  }
}

function architecture(d,map,mountedLabel){
  // The IFC includes a paved entrance apron and an external plant yard.
  // Flat paint distinguishes these service routes from the raised-floor hall.
  floor(d,-map.w+2,-map.h+2,map.w-2,-24.4,0x6e7e86);
  floor(d,-map.w+2,52.4,map.w-2,map.h-2,0x6e7e86);
  floor(d,-map.w+2,-24.4,-44.4,52.4,0x75868b);
  floor(d,20.4,-24.4,map.w-2,52.4,0x75868b);
  for(let x=-26;x<26;x+=5.5){
    d.box(0xbac4c4,[x,.026,-62],[.10,.01,7]);
    d.box(0xbac4c4,[x+2.75,.026,-65.5],[5.5,.01,.10]);
  }
  for(let z=-22;z<24;z+=5)d.box(0xd0b967,[23.3,.026,z],[.13,.01,2.8]);
  for(let x=-40;x<18;x+=6)d.box(0xd0b967,[x,.026,-26.8],[3,.01,.13]);
  floor(d,-43.4,-9.6,-6.5,23.4,0x97a8ae,true);
  floor(d,-6,-9.6,-2,23.5,0x839aa4);
  floor(d,-1.5,-9.6,19.4,23.4,0xa6b1ad,true);
  floor(d,-43.4,-23.4,19.4,-14.4,0x9aa8ac);
  floor(d,-43.4,-14,19.4,-10.2,0x788f9c);
  floor(d,-43.4,30.4,-7.2,51.4,0x9d9e93);
  floor(d,-6.6,30.4,19.4,51.4,0xb39f7e);
  floor(d,-43.4,24.6,19.4,30,0x7c929b);
  for(let z=31;z<51;z+=.65)d.box(0x8c775d,[6.4,.016,z],[25.8,.006,.015]);
  // Surface stripes guide traffic without introducing uncollidable furniture.
  for(const x of [-5.65,-2.35])d.box(C.cyan,[x,.026,6.8],[.08,.01,32]);
  for(const z of [-13.6,25.1,29.5])d.box(C.cyan,[-12,.026,z],[59.5,.01,.085]);
  for(const b of map.boxes.filter(b=>b[6]===1&&b[1]<.1&&b[4]<7)){
    const [x0,,z0,x1,h,z1]=b,x=(x0+x1)/2,z=(z0+z1)/2,w=x1-x0,depth=z1-z0;
    for(const y of [.15,Math.min(h-.12,3.45)]){
      d.box(C.steel,[x,y,z0-.027],[w,.09,.06],'metal');
      d.box(C.steel,[x,y,z1+.027],[w,.09,.06],'metal');
      d.box(C.steel,[x0-.027,y,z],[.06,.09,depth],'metal');
      d.box(C.steel,[x1+.027,y,z],[.06,.09,depth],'metal');
    }
    // Vertical steel mullions follow actual partition faces.
    if(w>4&&depth<1)for(let xx=x0+.6;xx<x1;xx+=2.6){
      d.box(0x9daeb5,[xx,h*.5,z0-.028],[.035,h-.1,.04],'metal');
      d.box(0x9daeb5,[xx,h*.5,z1+.028],[.035,h-.1,.04],'metal');
    }
  }
  for(const b of map.boxes.filter(b=>b[6]===1&&b[1]>3&&b[1]<5.5)){
    const y=b[1]-.13;
    for(let x=b[0]+3;x<b[3]-1;x+=6)for(let z=b[2]+3;z<b[5]-1;z+=6){
      d.box(C.steel,[x,y,z],[2.5,.1,.3],'metal');
      d.box(C.light,[x,y-.06,z],[2.35,.028,.19],'light');
    }
  }
  for(const [x,color]of[[-5.3,C.red],[-4.9,C.blue],[-2.7,C.cyan]])
    d.cylinder(color,[x,4.35,6.5],[.10,32,.10],'paint',[Math.PI/2,0,0]);
  for(let z=-7;z<24;z+=5)d.box(C.steel,[-4,4.43,z],[3.1,.045,.045],'metal');
  for(const z of [7.7,17.7])for(const [dz,color]of[[-.24,C.blue],[.24,C.cyan]]){
    d.cylinder(color,[25,4.45,z+dz],[.14,10,.14],'paint',[0,0,Math.PI/2]);
    d.cylinder(color,[30,3.325,z+dz],[.14,2.25,.14],'paint');
  }
  // The real model has an upper office / NOC strip. Glazing is mounted on its
  // solid collision block, retaining a closed, non-playable upper level.
  for(const b of map.boxes.filter(b=>b[6]===1&&b[1]>5.4&&b[4]>8)){
    const [x0,y0,z0,x1,y1,z1]=b;
    for(const z of [z0-.045,z1+.045]){
      for(let x=x0+1.4;x<x1-1;x+=2.8){
        d.box(0x527c91,[x,(y0+y1)/2,z],[2.5,y1-y0-.7,.065],'glass');
        d.box(0x97bdcb,[x,(y0+y1)/2+.2,z+(z<z0?-.04:.04)],[2.35,.04,.025],'metal');
        for(const dx of [-1.27,1.27])d.box(C.steel,[x+dx,(y0+y1)/2,z],[.075,y1-y0-.4,.1],'metal');
      }
      for(const y of [y0+.12,y1-.12])d.box(C.steel,[(x0+x1)/2,y,z],[x1-x0,.2,.12],'metal');
    }
    d.label('NORD  DC-02','DATA CENTRE  /  NETWORK OPERATIONS',[(x0+x1)/2,(y0+y1)/2,z0-.15],9,Math.PI,'#193b52');
  }
  const signs=[
    ['DATA HALL  /  48 RACKS','A  ·  COLO1  /  DUAL POWER A + B',[-22,3.65,-9.8],10,'#174557'],
    ['TECHNICAL CORRIDOR','UPS A / B   ·   ELECTRICAL   ·   PUMPS',[-4,3.4,9],7,'#234659'],
    ['UPS A','POWER PATH A',[-1.4,3.3,20],3.8,'#693746'],
    ['UPS B','POWER PATH B',[-1.4,3.3,11],3.8,'#284b79'],
    ['ELECTRICAL','SWITCHGEAR  /  DISTRIBUTION',[-1.4,3.3,3],4.5,'#645739'],
    ['PUMP ROOM','CHILLED WATER LOOP',[-1.4,3.3,-6],4.2,'#285c71'],
    ['FUTURE DATA HALL','B  ·  EXPANSION RESERVE',[-26,3.7,30.4],9,'#5c6055'],
    ['STAFF LOUNGE','KITCHENETTE  /  DINING',[7,3.6,30.4],7,'#67583f'],
    ['RECEPTION','NORD  /  DC-02',[-37,3.5,-24],7,'#234659'],
    ['LOADING / WORKSHOP','SERVICE ACCESS',[-18,3.5,-24],7,'#455964'],
    ['COOLING + STANDBY POWER','EAST SERVICE YARD',[20,3.65,5],9,'#285668'],
  ];
  for(const [title,subtitle,target,width,color]of signs)mountedLabel(d,map,title,subtitle,target,width,color);
}

export function buildDatacenter(d,map,mountedLabel){
  architecture(d,map,mountedLabel);
  rackDetails(d,map);utilityDetails(d,map);plantDetails(d,map);
  // Beyond the collision boundary, a low campus plinth grounds the building.
  d.box(0x60767c,[0,-.4,0],[map.w*2+18,.6,map.h*2+18]);
}
