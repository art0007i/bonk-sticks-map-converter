import express from 'express';
import unzip from 'unzipper';
import BeatSaverAPI from 'beatsaver-api';
import { MapDetailMetadata } from 'beatsaver-api/lib/models/MapDetailMetadata';
import { MapDetail } from 'beatsaver-api/lib/models/MapDetail';
import { MapVersion } from 'beatsaver-api/lib/models/MapVersion';
import axios from 'axios';
import stream from 'stream';
import { MapDifficulty, MapSetType, ParseBeatSaberMap } from './parser';
import fs from 'fs/promises';
import oldfs from 'fs';
import path from 'path';
import { SearchOptions, SortOrder } from 'beatsaver-api/lib/api/search';

// kind of like Promise.all, but catches errors and puts them into the results array
// useful when you are waiting for a bunch of stuff that may or may not fail, and that's ok
async function CoolPromiseAll<T>(promises: Promise<T>[]): Promise<(T|Error)[]>
{
  return await Promise.all(
    promises.map(async (promise) => {
      try {
        return await promise;
      } catch (error) {
        return error;
      }
    })
  );
}

const OUT_DIR = "./static";

if (!oldfs.existsSync(OUT_DIR)){
    oldfs.mkdirSync(OUT_DIR);
}

const app = express();
const port = 5901;
const api = new BeatSaverAPI({
  AppName: 'NeosVR Map Converter',
  Version: '1.0.0'
});
const pendingJobs: JobBuffer = {};

interface JobBuffer {
  [key: string]: SongJob
}
interface SongJob {
  promise: Promise<void>
  step: SongJobStep
}
enum SongJobStep {
  GettingMapInfo,
  DownloadingMap,
  ParsingMap,
  WritingFiles,
}

interface SimpleMapDiff {
  nps: number;
  notes: number;
  obstacles: number;
  bombs: number;
  njs: number;
  offset: number;
  seconds: number;
  
  label: string;

  characteristic: MapSetType;
  difficulty: MapDifficulty;
}

interface SimpleMapInfo {
  // from root
  id: string;
  name: string;
  //description: string;

  metadata: MapDetailMetadata;

  // stats
  //downvotes: number;
  upvotes: number;  // the simplify function will make this var the sum of down and up votes

  // version
  coverURL: string;
  //downloadURL: string; // only will use id I guess lol
  //previewURL: string; // its mp3 :sob:
  diffs: SimpleMapDiff[];
}

function SimplifyMapInfo(i: MapDetail): SimpleMapInfo
{
  return {
    id: i.id,
    name: i.name,
    //description: i.description,

    metadata: i.metadata,

    //downvotes: i.stats.downvotes,
    upvotes: i.stats.upvotes - i.stats.downvotes,

    coverURL: GetLatestMapVersion(i).coverURL,
    //downloadURL: GetLatestMapVersion(i).downloadURL
    
    diffs: GetLatestMapVersion(i).diffs.map(diff=> {
      return {
        nps: diff.nps,
        notes: diff.notes,
        obstacles: diff.obstacles,
        bombs: diff.bombs,
        njs: diff.njs,
        offset: diff.offset,
        seconds: diff.seconds,
        characteristic:  MapSetType[diff.characteristic as keyof typeof MapSetType],
        difficulty: MapDifficulty[diff.difficulty as keyof typeof MapDifficulty],
        label: diff.label,
      }
    })
  }
}

function GetLatestMapVersion(mapinfo: MapDetail): MapVersion
{
  return mapinfo.versions[0];
}

// Search endpoint
app.get('/search', (req, res) => {
  const p = req.query.p;
  const query = req.query.q;
  const ex = req.query.ex;
  const page = typeof p === 'string' ? parseInt(p) : 0;
  const unsupported = typeof ex === 'string' && ex == 'true';

  console.log("searching: " + (query ? query : "latest maps"));
  
  let order: SortOrder = SortOrder.Latest
  let search = ""
  if(typeof query === 'string' && query){
    order = SortOrder.Relevance
    search = query
  }
  
  let searchOpts: SearchOptions = {
    sortOrder: order,
    q: search,
  }

  if(!unsupported){
    searchOpts.noodle = false
    searchOpts.me = false
  }
  api.searchMaps(searchOpts, Math.floor(page/2)).then((resp)=>{
    const even = page % 2 == 0;
    const mapped: SimpleMapInfo[] = resp.docs.map(SimplifyMapInfo);
    let sendobj = []
    if(even){
        sendobj = mapped.slice(0,10);
    }else{
        sendobj = mapped.slice(10);
    } 
    res.send({L: sendobj});
  });
});

enum MapFileType {
  Info,
  Song,
  Cover,
}

// function will wait if file is available or return null if it never will be available
async function TryGetMapFile(mapId: string, type: MapFileType): Promise<false | Buffer> {
  const mapPath = path.join(OUT_DIR, mapId);
  // check if map is pending
  if(mapId in pendingJobs){
    // wait for it not to be pending...
    await pendingJobs[mapId].promise;
  }
  else {
    // if the map ISN'T pending and it ISN'T cached, just return null
    try{
      const stat = oldfs.statSync(mapPath);
      if(!stat){
        return null;
      }
    } catch {
      return null;
    }
  }


  // this case will be triggered if either it was pending and now isn't, or it wasn't pending but was found on file system
  switch(type) {
    case MapFileType.Cover:
      return await fs.readFile(path.join(mapPath, "cover"));
    case MapFileType.Song:
      return await fs.readFile(path.join(mapPath, "song.egg"));
    case MapFileType.Info:
      return await fs.readFile(path.join(mapPath, "map.json"));
  }
}

app.get('/:id/cover', async (req,res)=>{
  const resp = await TryGetMapFile(req.params.id, MapFileType.Cover);
  if(resp){
    res.send(resp)
  }else{
    res.status(404).send("not found");
  }
});
app.get('/:id/song', async (req,res)=>{
  const resp = await TryGetMapFile(req.params.id, MapFileType.Song);
  if(resp){
    res.send(resp)
  }else{
    res.status(404).send("not found");
  }
});

// Download endpoint
app.get('/:id/mapdata', async (req, res) => {
  const mapId = req.params.id;
  console.log("GET " + mapId);
  const outPath = path.join(OUT_DIR, mapId);

  const tryMapInfo = await TryGetMapFile(mapId, MapFileType.Info);
  if(tryMapInfo){
    res.header("Content-Type", "text/plain").send(tryMapInfo);
    return;
  }

  let resolveFunc;
  const mapJob: SongJob = {
    promise: new Promise((resolve)=>{
      resolveFunc = resolve;
    }),
    step: SongJobStep.GettingMapInfo,
  }
  pendingJobs[mapId] = (mapJob);

  const map = await api.getMapByID(mapId);
  const mapURL = GetLatestMapVersion(map).downloadURL;

  mapJob.step = SongJobStep.DownloadingMap;

  // Download the zip file
  const response = await axios({
    method: "get",
    url: mapURL,
    responseType: "stream"
  });
  mapJob.step = SongJobStep.ParsingMap;

  // Unpack the zip file
  const startDate = Date.now();
  //const unzipper = unzip.Extract({path: outPath});

  const filesBuffers = {};

  response.data.pipe(unzip.Parse())
  .pipe(new stream.Transform({
    objectMode: true,
    transform: async (entry, enc, cb)=>{
    if(entry.type == "File"){
      filesBuffers[entry.path] = await entry.buffer();
      cb()
    }else{
      await entry.autodrain();
      cb()
    }
  }
})).on('finish', async ()=>{
    const neosMapFile = await ParseBeatSaberMap(mapId, filesBuffers);

    mapJob.step = SongJobStep.WritingFiles;

    res.send(neosMapFile);
    console.log("Finished downloading & parsing " + mapId + " in " + (Date.now()-startDate) + "ms.");
    try{
      oldfs.mkdirSync(outPath, {recursive: true});
    }catch{
      // already exists
    }
    const promises = [];
    promises.push(fs.writeFile(path.join(outPath,"map.json"), JSON.stringify(neosMapFile)));
    // I'll call it .egg cuz neos doesn't seem to care about extensions much anyway
    promises.push(fs.writeFile(path.join(outPath, "song.egg"), filesBuffers[neosMapFile.songFilename]));
    if(filesBuffers[neosMapFile.coverImage]){
      //const coverExtension = path.extname(neosMapFile.coverImage)
      // trolling: no extension, but u can figure it out neos vr gamers
      promises.push(fs.writeFile(path.join(outPath, "cover"), filesBuffers[neosMapFile.coverImage]));
    }else{
      console.log(`found coverless song on ${mapId} (this is fine but annoying xd)`);
    }
    const results = await CoolPromiseAll(promises);
    results.forEach(el=>{
      console.log(el);
      if(el instanceof Error){
        console.error("shit's fucked!!! " + mapId + " deleting remains, idk retry it later");
        fs.rm(outPath, {force:true, recursive:true});
      }
    });
    resolveFunc();
  });
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});