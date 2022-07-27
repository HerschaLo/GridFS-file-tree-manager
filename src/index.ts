import { MongoClient, GridFSBucket,  Db, ObjectId, InsertOneResult, GridFSBucketReadStream, GridFSFile, Document} from "mongodb"
import {Readable} from "stream"
import JSZip, { OutputType } from "jszip"

interface FileOptions{
    name: string,
    chunkSize: number,
    customMetadata?:object
}

/** Stores a folder tree in MongoDB using GridFS. Automatically connects to MongoDB for all methods. */
class FolderTree{
    
    private _currentWorkingDirectory: string 
    private _bucket: GridFSBucket
    private _db:Db
    private _folderCollectionName: string
    private _client:MongoClient
    private _bucketName: string
    
    /**
     * @constructor
     * Connect to a folder tree in a MongoDB database. If a folder tree does not already exist with the specified 
     * GridFS bucket and folder storage collection, it is created. 
     * @param {string} client - MongoDB Client
     * @param {string} dbName - Name of a Mongo database instance 
     * @param {string} bucketName - Name of the GridFS bucket that will store the files of the folder tree
     * @param {string} folderCollectionName - Name of the collection in the Mongo database specified by dbName
     * that will be used for folder storage, store documents representing folders in the folder tree. 
     */
    constructor(mongoClientURI: string, dbName: string, bucketName: string, folderCollectionName: string){
        this._client = new MongoClient(mongoClientURI)
        
        this._currentWorkingDirectory = folderCollectionName
        
        this._bucket  = new GridFSBucket(this._client.db(dbName), {bucketName:bucketName})
        
        this._db= this._client.db(dbName)
        
        this._folderCollectionName = folderCollectionName

        this._bucketName = bucketName
    }
    /**
     * MongoDB instance storing the folder tree
     */
    public get db(){
        return this._db
    }
    /**
     * GridFS bucket that stores the files of the folder tree
     */
    public get bucket(){
        return this._bucket
    }
    /**
     * Name of the GridFS bucket that stores the files of the folder tree
     */
    public get bucketName(){
        return this._bucketName
    }
    /**
     * Name of the collection in the Mongo database specified by dbName
     * that will be used for folder storage, store documents representing folders in the folder tree. 
     */
    public get folderCollectionName(){
        return this._folderCollectionName
    }
    /**
     * Current working directory of the folder tree
     */
    public get currentWorkingDirectory(){
        return this._currentWorkingDirectory
    }

    /**
     * @description Creates a document representing a folder in the collection specified by folderCollectionName. 
     * Its parent directory will be the current value of the `currentWorkingDirectory` property. 
     * @param {string} name Name of the folder
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const folders = new FolderTree(new MongoClient("mongodb://localhost:27017"), "GridFS-folder-management-sample", "sample-bucket", "sample-folder")
     * let result = await folderSystem.createFolder("subfolder-sample")
     */

    createFolder(name: string){
        return new Promise<InsertOneResult>(async (resolve, reject)=>{
            this._client.connect(async ()=>{
                let path = this.currentWorkingDirectory+`/${name}`
                
                let doesFolderExist = Boolean(await this._db.collection(this._folderCollectionName).findOne({"path":path}))
                if(doesFolderExist ){
                    return reject(new Error("Folder with this name already exists in the current directory"))
                }

                let result =  await this._db.collection(this._folderCollectionName).insertOne({name:name, path:path, parentDirectory:this.currentWorkingDirectory})
                resolve(result)
            })
        })
    }
    /**
     * @description Returns a promise which resolves to a `GridFSBucketReadStream` of a file stored in the GridFS Bucket specified by bucketName property.
     * @param {string} filePath String representing the absolute path of the file
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const folders = new FolderTree(new MongoClient("mongodb://localhost:27017"), "GridFS-folder-management-sample", "sample-bucket", "sample-folder")
     * let stream = await folderSystem.getFileReadStream("sample-folder/sample.txt")
     */

    getFileReadStream(filePath: string){
        return new Promise<GridFSBucketReadStream>((resolve, reject)=>{
            this._client.connect(async ()=>{
                let file = (await this._bucket.find({"metadata.path":filePath, "metadata.isLatest":true}).toArray())[0]

                if(!file){
                    return reject(new Error(`File with path ${filePath} does not exist`))
                }
                resolve(this._bucket.openDownloadStream(file._id))
            })
        })

    }
    /**
     * @description Converts the folder specified in the folderPath parameter into a zip file for download. The form which the zip-file is returned varies 
     * based on the argument provided for the returnType parameter. 
     * @param {string} folderPath String representing the absolute path of the file
     * @param {string} returnType String specifying the form in which the zip file of the target folder should be returned. Options are 'base64','nodebuffer', 
     * 'array', 'uint8array','arraybuffer', 'blob', and 'binarystring'.
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const folders = new FolderTree(new MongoClient("mongodb://localhost:27017"), "GridFS-folder-management-sample", "sample-bucket", "sample-folder")
     * //Returns an array of bytes (numbers between 255 and 0)
     * let zip = await folderSystem.downloadFolder("sample-folder/subfolder-sample", "array")
     */
    downloadFolder(folderPath: string, returnType: OutputType){
        return new Promise<Buffer|Uint8Array|String|Blob|Number[]|ArrayBuffer>((resolve, reject)=>{
            this._client.connect(async ()=>{
                let folderZip = new JSZip()

                const downloadAsync = async (file: GridFSFile): Promise<void> =>{
                    return new Promise<void>((resolve, reject)=>{
                        let downloadStream = this._bucket.openDownloadStream(file._id)
                        let data = ''
                        downloadStream.on("data",(chunk)=>{
                            data+=chunk.toString("base64")
                        })
                        downloadStream.on("end",()=>{
                            folderZip.file(file.metadata?.path.slice(folderPath.length+1), data, {createFolders:true, base64:true})
                            resolve()
                        })
                    })
                }

                let aggregationActions = []

                let topFolder = await this._db.collection(this._folderCollectionName).findOne({"path":folderPath})

                if(!topFolder && folderPath !== this._folderCollectionName){
                    return reject(new Error(`Folder with path ${folderPath} does not exist`))
                }

                if(!['base64','nodebuffer', 'array', 'uint8array','arraybuffer', 'blob', 'binarystring'].includes(returnType)){
                    return reject(new Error(`Invalid argument for parameter returnType. Argument must either be 'base64','nodebuffer', 'array', 'uint8array','arraybuffer', 'blob', or 'binarystring'.`))
                }

                if(folderPath !== this._folderCollectionName){
                    aggregationActions.push({$match:
                        { "path":folderPath}
                    })
                }

                aggregationActions.push({$graphLookup:{
                    from:`${this._folderCollectionName}`,
                    startWith:"$path",
                    connectFromField:"path",
                    connectToField:"parentDirectory",
                    as:"folders",
                }})

                aggregationActions.push({$graphLookup:{
                    from:`${this._bucketName}.files`,
                    startWith:"$path",
                    connectFromField:"path",
                    connectToField:"metadata.parentDirectory",
                    as:"files",
                    restrictSearchWithMatch:{"metadata.isLatest":true}
                }})

                let initialSearch = (await this._db.collection(this._folderCollectionName).aggregate(aggregationActions).toArray())

                let initialFiles: Array<GridFSFile> = initialSearch[0].files
                
                if(folderPath === this._folderCollectionName){
                   initialFiles = initialFiles.concat(await this._bucket.find({"metadata.parentDirectory":folderPath}).toArray())
                }

                let folders = initialSearch[0].folders
                let allFiles: Array<GridFSFile> = await this._bucket.find({"metadata.isLatest":true, "metadata.parentDirectory":{$in:folders.map((folder: any) => {return folder.path})}}).toArray()
                
                for(let i=0; i<initialFiles.length; i++){
                    await downloadAsync(initialFiles[i])
                }

                for(let i=0; i<allFiles.length; i++){
                    await downloadAsync(allFiles[i])
                }
                return resolve(await folderZip.generateAsync({type:returnType}))
            })
        })
    }
    /**
     * @description Converts the folder specified in the folderPath parameter into a zip file for download. The form which the zip-file is returned varies 
     * based on the argument provided for the returnType parameter. 
     * @param {Readable} fileStream Valid readable stream
     * @param {FileOptions} options Options for the file
     * @param {string} options.name Name of the file
     * @param {number} options.chunkSize Size of the file in bytes
     * @param {object} options.customMetadata Custom metadata properties to add to the file. Any property can be added. 
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const folders = new FolderTree(new MongoClient("mongodb://localhost:27017"), "GridFS-folder-management-sample", "sample-bucket", "sample-folder")
     * let stream = await folderSystem.uploadFile(fs.createReadStream("sample.txt"), {name:"sample.txt", chunkSize:1048576, customMetadata:{starred:true}})
     */
    uploadFile(fileStream: Readable, options: FileOptions){
        return new Promise<ObjectId>((resolve, reject)=>{
            if (!(fileStream instanceof Readable)){
                return reject(new Error("Argument for parameter fileStream is not a valid readable stream"))
            }
            let path = this.currentWorkingDirectory+`/${options.name}`
            
            this._client.connect(()=>{
                this._db.collection(this._bucketName+".files").findOneAndUpdate({"metadata.path":path, "metadata.isLatest":true},{$set:{"metadata.isLatest":false}})
                let uploadStream = this._bucket.openUploadStream(options.name, {
                    
                    chunkSizeBytes:options.chunkSize,

                    metadata:{
                        parentDirectory:this.currentWorkingDirectory, 
                        path:path,
                        isLatest:true,
                        ...options.customMetadata
                    }

                })

                fileStream.pipe(uploadStream)
                uploadStream.on("finish",async ()=>{
                    resolve(uploadStream.id)
                })
            })
        })
    }
    /**
     * @description Changes the current active directory of the folder system, which is where the methods 
     * uploadFile and createFolder 
     * @param {string} path If parameter `isRelative` is false, or not provided, `path` should be a 
     * string representing the absolute path to a directory that exists in the collection specified by the 
     * `folderCollectionName` property. If parameter `isRelative` is true, `path` is assumed to be relative 
     * to the current active directory.
     * @param {string} isRelative If true, parameter `path` must be relative. If false, which is the default value, 
     * parameter `path` must be the absolute path. 
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const folders = new FolderTree(new MongoClient("mongodb://localhost:27017"), "GridFS-folder-management-sample", "sample-bucket", "sample-folder")
     * //Absolute path
     * await folderSystem.changeDirectory("sample-folder/subfolder-sample")
     * //Relative path
     * await folderSystem.changeDirectory("subfolder-sample-2", true)
     */
    changeDirectory(path: string, isRelative = false){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async ()=>{
                let absolutePath
                if(!isRelative){
                    absolutePath = path
                }
                else{
                    absolutePath = this.currentWorkingDirectory+"/"+path
                }
                let folder = await this._db.collection(this._folderCollectionName).findOne({"path":absolutePath})
            
                if(folder || absolutePath == this._folderCollectionName){
                    this._currentWorkingDirectory = absolutePath
                    resolve()
                }
                else{
                    return reject(new Error(`Folder with path ${absolutePath} does not exist`))
                }
            })
        })
    }
    /**
     * @description Deletes a folder 
     * @param {string} folderPath Absolute path of a folder that exists in the collection 
     * specified by the `folderCollectionName` property
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const folders = new FolderTree(new MongoClient("mongodb://localhost:27017"), "GridFS-folder-management-sample", "sample-bucket", "sample-folder")
     * await folderSystem.deleteFolder("sample-folder/subfolder-sample")
     */
    deleteFolder(folderPath: string){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async()=>{
                
                let aggregationActions = []
                let topFolder = await this._db.collection(this._folderCollectionName).findOne({"path":folderPath})

                if(!topFolder && folderPath !== this._folderCollectionName){
                    return reject(new Error(`Folder with path ${folderPath} does not exist`))
                }

                if(folderPath !== this._folderCollectionName){
                    aggregationActions.push({$match:
                        { "path":folderPath}
                    })
                }

                aggregationActions.push({$graphLookup:{
                    from:`${this._folderCollectionName}`,
                    startWith:"$path",
                    connectFromField:"path",
                    connectToField:"parentDirectory",
                    as:"folders",
                }})

                aggregationActions.push({$graphLookup:{
                    from:`${this._bucketName}.files`,
                    startWith:"$path",
                    connectFromField:"path",
                    connectToField:"metadata.parentDirectory",
                    as:"files",
                    restrictSearchWithMatch:{"metadata.isLatest":true}
                }})

                let initialSearch = (await this._db.collection(this._folderCollectionName).aggregate(aggregationActions).toArray())
                let initialFiles: Array<GridFSFile> = initialSearch[0].files
                let folders = initialSearch[0].folders
                let allFiles: Array<GridFSFile> = await this._bucket.find({"metadata.isLatest":true, "metadata.parentDirectory":{$in:folders.map((folder: Document) => {return folder.path})}}).toArray()
                
                if(folderPath == this._folderCollectionName){
                    initialFiles = initialFiles.concat(await this._bucket.find({"metadata.parentDirectory":folderPath}).toArray())
                }
                for(let i=0; i<initialFiles.length; i++){
                    await this.deleteFile(initialFiles[i].metadata?.path)
                }

                for(let i=0; i<allFiles.length; i++){
                    await this.deleteFile(allFiles[i].metadata?.path)
                }

                await this._db.collection(this._folderCollectionName).deleteMany({"_id":{$in:folders.map((folder: Document) => {return folder._id})}})

                if(folderPath !== this._folderCollectionName){
                    await this._db.collection(this._folderCollectionName).deleteOne({"path":folderPath})
                }

                resolve()
            })
        })
    }
    /**
     * @description Deletes all the versions of a file 
     * @param {string} filePath Absolute path to a file that exists in the bucket specified by the `bucket` 
     * property on the `FolderTree` class
* @since 1.0.0
     * @version 0.1.0
* @example
     *
     * const folders = new FolderTree(new MongoClient("mongodb://localhost:27017"), "GridFS-folder-management-sample", "sample-bucket", "sample-folder")
     * await folderSystem.deleteFile("sample-folder/sample.txt")
     */
    deleteFile(filePath: string){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async ()=>{
                let allFileVersions = this._bucket.find({"metadata.path":filePath})

                if(!(await allFileVersions.hasNext())){
                    return reject(new Error(`File with path ${filePath} does not exist`))
                }

                let allFileVersionsArr = await allFileVersions.toArray()

                for(let i=0; i<allFileVersionsArr.length; i++){
                    await this._bucket.delete(allFileVersionsArr[i]._id)
                }

                resolve()
            })
        })
    }
}

export default FolderTree