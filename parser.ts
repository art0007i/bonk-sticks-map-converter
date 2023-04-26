export enum MapSetType {
  Standard,
  NoArrows,
  OneSaber,
  Degree360,
  Degree90,
  Lightshow,
  Lawless,
}

export enum MapDifficulty {
  Easy,
  Normal,
  Hard,
  Expert,
  ExpertPlus,
}

export interface NeosMapFile {
  mapID: string,
  bpm: number,
  name: string,
  previewStart: number,
  previewDuration: number,
  songFilename: string,
  coverImage: string,
  environment: string,
  timeOffset: string,
  mapSets: {
    [key in MapSetType]: {
      [key in MapDifficulty]: NeosMap
    }
  }
}

export interface NeosMap {
  difficulty: string,
  njs: number,
  njsOffset: number,
  label: string,
  difficultyFile: string,
}

export async function ParseBeatSaberMap(mapID: string, files: object): Promise<NeosMapFile> {
  const InfoFile: Buffer = files[Object.keys(files).find((s)=>s.toLowerCase() === "info.dat")];

  const ROOT = JSON.parse(InfoFile.toString("utf8"));
  const bpm = ROOT._beatsPerMinute;

  const OUTROOT: NeosMapFile = {
    // TODO: add less stuf here? cuz it will pull it from search req anyway ig
    mapID: mapID,
    bpm: bpm,
    name: ROOT._songName,
    previewStart: ROOT._previewStartTime,
    previewDuration: ROOT._previewDuration,
    songFilename: ROOT._songFilename,
    coverImage: ROOT._coverImageFilename,
    environment: ROOT._environmentName,
    timeOffset: ROOT._songTimeOffset,
    mapSets: ROOT._difficultyBeatmapSets.reduce((acc,mapSet) => {
      const key: MapSetType = MapSetType[mapSet._beatmapCharacteristicName as keyof typeof MapSetType];
      if(key !== undefined && !acc[key]){
        acc[key] = mapSet._difficultyBeatmaps.reduce((acc,diff) => {
          let label = null;
          if(diff._customData && diff._customData._difficultyLabel){
            label = diff._customData._difficultyLabel;
          }
          const key: MapDifficulty = MapDifficulty[diff._difficulty as keyof typeof MapDifficulty];
          if(key !== undefined && !acc[key]){
            acc[key] = {
              // thank you 1 mapper who put 0 njs, you are so smart
              njs: diff._noteJumpMovementSpeed === 0 ? 10 : diff._noteJumpMovementSpeed,
              njsOffset: diff._noteJumpStartBeatOffset,
              label: label,
              difficultyFile: genDifficultyFile(files, bpm, diff._beatmapFilename),
            }
          }else{
            console.log("Holy fuck you managed to do double some difficulty, why?");
          }
          return acc;
        }, {});
      }else{
        console.log("Holy fuck you managed to do double some gamemode, why?");
      }
      return acc;
    }, {}),
  };

  return OUTROOT;
}

function genDifficultyFile(files: object, bpm: number, diff: string) : string
{
  const diffBuffer: Buffer = files[diff];
  const DROOT = JSON.parse(diffBuffer.toString("utf8"));
  let v3 = false;
  if(DROOT.version && parseFloat(DROOT.version) >= 3){
    v3 = true;
  }else if(DROOT._version && parseFloat(DROOT._version) >= 3){
    // probably don't need this branch...
    v3 = true;
  }
  // combine all actions into one timeline
  const keys = v3 ?
    ["bpmEvents", "rotationEvents", "colorNotes", "bombNotes", "obstacles", "burstSliders", "basicBeatmapEvents", "colorBoostBeatmapEvents"]:
    ["_events", "_notes", "_obstacles"];
  const timeLine = [];

  for (const key of keys) {
    console.log("[PARSER] trying to enter key??"  + key);
    const elements = DROOT[key];
    if(!elements) continue;
    console.log("[PARSER] entering " + key);

    for (const element of elements) {
      const newElement = {
        type: key.slice(0, key.length-1),
        time: v3 ? element.b : element._time,
      };

      if(key === "burstSliders"){
        // this is probably horrible, idk
        // sliders will have 2 notes, start and end
        
        // implement squish??
        // so its lerp between star and end x,y
        // and squish is the lerp value
        const burstEndElement = {
          type: key.slice(0, key.length-1),
          time: element.tb,
          x: element.tx,
          y: element.ty,
          c: element.c,
          d: element.d
        };
        newElement['x'] = element.x
        newElement['y'] = element.y
        newElement['c'] = element.c
        newElement['d'] = element.d
        timeLine.push(burstEndElement);
        break;
      }else{
        for (const prop in element) {
          if (prop !== (v3 ?  'b' : '_time')) {
            newElement[prop] = element[prop];
          }
        }
      }


      timeLine.push(newElement);
    }
  }
  timeLine.sort((a, b) => a.time - b.time);

  // let lastTime = 0;
  // Convert to our format
  const outTimeLine = timeLine.map((el) => {
    const bps = bpm / 60;
    let outstr = "";
    switch(el.type){
      // v2 map format
      case '_event':
          return null;
          break;
      case '_note':
        outstr = "N,"
        outstr += el.time / bps + "," // IN BEATS
        outstr += el._lineIndex + "," // col
        outstr += el._lineLayer + "," // row
        outstr += el._type + ","
        outstr += el._cutDirection + ","
        outstr += 0 // angle offset (ccw)
        return outstr;
        break;
      case '_obstacle':
        outstr = "O,"
        outstr += el.time / bps + "," // IN BEATS
        outstr += el._lineIndex + "," // col
        outstr += el._type * 2 + ","// row
        outstr += el._width + "," // w
        outstr += 5-(el._type * 2) + "," // h
        outstr += el._duration / bps // IN BEATS
        return outstr;
        break;

      // v3 format
      case 'bpmEvent':
        // they don't exist dont worry about it
        //bpm = el.m;
        return null;
        break;
      case 'rotationEvent':
        return null; // what the fuck even is this
        break;
      case "colorNote":
        outstr = "N,"
        outstr += el.time / bps + "," // IN BEATS
        outstr += el.x + "," // col
        outstr += el.y + "," // row
        outstr += el.c + "," // color (0red 1blue)
        outstr += el.d + "," // direction
        outstr += el.a // angle offset (Ccw)
        return outstr;
      case "bombNote":
        outstr = "N,"
        outstr += el.time / bps + "," // IN BEATS
        outstr += el.x + "," // col
        outstr += el.y + "," // row
        outstr += 3 + "," // bomb is 3
        outstr += 0 + "," // bomb dont have directions
        outstr += 0 // angle offset (ccw)
        return outstr;
      case "obstacle":
        outstr = "O,"
        outstr += el.time /bps + "," // IN BEATS
        outstr += el.x + "," // col
        outstr += el.y + ","// row
        outstr += el.w + "," //w
        outstr += el.h + "," //h
        outstr += el.d /bps // IN BEATS
        return outstr;
      case "burstSlider":
        outstr = "N,"
        outstr += el.time / bps + "," // IN BEATS
        outstr += el.x + "," // col
        outstr += el.y + "," // row
        outstr += el.c + ","
        outstr += el.d + ","
        outstr += 0 // angle offset (ccw)
        outstr += "\n"
        return outstr;
      case "basicBeatmapEvent":
      case "colorBoostBeatmapEvent":
        return null;
    }
  }).filter((el)=>el!=null).join("\n");
  return outTimeLine;
}