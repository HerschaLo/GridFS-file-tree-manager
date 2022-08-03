import { MongoClient, GridFSBucket,  Db, ObjectId, InsertOneResult, GridFSBucketReadStream, GridFSFile} from "mongodb"
import {Readable} from "stream"
import JSZip, { OutputType } from "jszip"

/**
 * Shape of the object to be provided as an argument for the `options` parameter
 * of the `uploadFile` method on the MongoFileTree class.
 */
interface FileOptions{
    /** Name of the file being uploaded  */
    name: string,
    /** Size of the file chunks in GridFS */
    chunkSize: number,
    /** Custom metadata properties to add to the file. Any property can be added besides 'path', 'parentDirectory', and 'isLatest' can be added. Is optional.  */
    customMetadata?:MetadataOptions
}

/**
 * Object type representing custom metadata that the user can add to folders and files.
 * Can have any property except 'path', 'parentDirectory', and 'isLatest'.
 * This prevents users from improperly modifying these properties using class methods, as they
 * are critical to the basic functioning of the file tree.
 */
type MetadataOptions = Omit<object, "path" | "parentDirectory"| "isLatest">

/** Stores a file tree in MongoDB using GridFS.
 * Files will be stored in a GridFS Bucket, and the documents in the `files` collection of the
 * bucket will have the following shape:
 * ```
 * {
 * "_id" : <ObjectId>,
 * "length" : <num>,
 * "chunkSize" : <num>,
 * "uploadDate" : <timestamp>,
 * "filename" : <string>,
 * "metadata" : {
 *      "parentDirectory":<string>, //Absolute path of the folder where the file is located
 *      "path":<string>, //Absolute path of the file
 *      "isLatest":<boolean>, //Is this the latest version of the file or not
 *      ...
 *  },
 * }
 * ```
 * The file tree can store multiple versions of a file.
 * The name of the file cannot have the following characters: /, $, %, ?, @, ", ', !, $, >, <, *, &, {,}, #, =,`, |, :, +, and whitespace characters.
 * An error will be raised if the user attempts to upload a file with those characters in its name or change a file's name
 * to a name that has those characters. The same is true for folder names. The folders of the file tree are stored as
 * documents in a separate collection from the bucket and possess the following shape in MongoDB:
 * ```
 *
 * {
 * "_id": <ObjectId>,
 * "name": <string>,
 * "path": <string>, //Absolute path of the folder
 * "parentDirectory":<string>, //Absolute path of the folder's parent folder.
 * "customMetadata": <object> //customMetadata can have any property specified by the user besides "isLatest", "path", or "parentDirectory"
 * }
 *
 * ```
 * The collection that stores folders is treated as the "root directory" of the file tree, with the
 * root directory's absolute path being the same as the name of the collection. A
 * `FileTree` object will also have a "current working directory",
 * with the absolute path to it being stored in the `currentWorkingDirectory` property.
 * The `currentWorkingDirectory` property will be the root directory when initialized.
 * The methods on this class to upload files and create folders automatically puts them under the
 * current working directory.
 * Note: this class automatically connects to MongoDB for all methods. 
 */
class MongoFileTree{

    private _currentWorkingDirectory: string
    private _bucket: GridFSBucket
    private _db:Db
    private _folderCollectionName: string
    private _client:MongoClient
    private _bucketName: string

    /**
     * @constructor
     * Connect to a MongoDB database that has a file tree. If any part of the file tree (database, folder storage collection, GridFS Bucket)
     * does not already exist, it is created
     * @param {string} mongoConnectionUrl - Connection URL to a MongoDB server
     * @param {string} dbName - Name of a MongoDB database
     * @param {string} bucketName - Name of the GridFS bucket that will store the files of the file tree
     * @param {string} folderCollectionName - Name of the collection in the Mongo database specified by dbName
     * that will be used for folder storage, store documents representing folders in the file tree
     */
    constructor(mongoConnectionUrl: string, dbName: string, bucketName: string, folderCollectionName: string){
        this._client = new MongoClient(mongoConnectionUrl)

        this._currentWorkingDirectory = folderCollectionName

        this._bucket  = new GridFSBucket(this._client.db(dbName), {bucketName})

        this._db= this._client.db(dbName)

        this._folderCollectionName = folderCollectionName

        this._bucketName = bucketName
    }
    /**
     * Mongo database storing the file tree.
     */
    public get db(){
        return this._db
    }
    /**
     * GridFS bucket that stores the files of the file tree.
     */
    public get bucket(){
        return this._bucket
    }
    /**
     * Name of the GridFS bucket that stores the files of the file tree.
     */
    public get bucketName(){
        return this._bucketName
    }
    /**
     * Name of the collection in the Mongo database specified by dbName
     * that will be used for folder storage, storing documents representing folders in the file tree.
     */
    public get folderCollectionName(){
        return this._folderCollectionName
    }
    /**
     * Absolute path of the current working directory of the file tree.
     * This directory is where the files uploaded by the uploadFile method
     * and the folders created by the createFolder method will be located.
     */
    public get currentWorkingDirectory(){
        return this._currentWorkingDirectory
    }
    /**
     * MongoDB client being used for the file tree.
     */
    public get client(){
        return this._client
    }

    /**
     * @description Creates a document representing a folder in the collection specified by `folderCollectionName`.
     * Its parent directory will be the current value of the `currentWorkingDirectory` property.
     * Will return an error if a folder with the name provided to the method already
     * exists in the current working directory of the file tree.
     * @param {string} folderName Name of the folder
     * @param {object} customMetadata Custom metadata properties to add to the folder.
     * Any property can be added except `path`, `isLatest`, or `parentDirectory`.
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * //Creates new folder with path sample-folder/subfolder-sample
     * let result = await fileTree.createFolder("subfolder-sample") //MongoDB InsertOneResult with the id of the document representing the folder
     */

    createFolder(folderName: string, customMetadata?: MetadataOptions){
        return new Promise<InsertOneResult>(async (resolve, reject)=>{
            this._client.connect(async ()=>{
                const path = this.currentWorkingDirectory+`/${folderName}`

                const doesFolderExist = Boolean(await this._db.collection(this._folderCollectionName).findOne({"path":path}))
                if(doesFolderExist){
                    return reject(new Error("Folder with this name already exists in the current directory"))
                }
                if(folderName.match(/\\|[/$%?@"'!$><\s*&{}#=`|:+]/)){
                    // @ts-ignore
                    const errSymbol = folderName.match(/\\|[/$%?@"'!$><\s*&{}#=`|:+]/)[0]
                    return reject(new Error(`Character "${errSymbol}" cannot be used as part of a folder name`))
                }

                const result =  await this._db.collection(this._folderCollectionName).insertOne({name:folderName, path, parentDirectory:this.currentWorkingDirectory, customMetadata:{...customMetadata}})
                resolve(result)
            })
        })
    }
    /**
     * @description Returns a promise which resolves to a `GridFSBucketReadStream` of a file stored in the
     * GridFS Bucket specified by the `bucketName` property.
     * @param {string} filePath Absolute path of the file to get a readable stream of
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * let stream = await fileTree.getFileReadStream("sample-folder/sample.txt")
     */

    getFileReadStream(filePath: string){
        return new Promise<GridFSBucketReadStream>((resolve, reject)=>{
            this._client.connect(async ()=>{
                const file = (await this._bucket.find({"metadata.path":filePath, "metadata.isLatest":true}).toArray())[0]

                if(!file){
                    return reject(new Error(`File with path ${filePath} does not exist`))
                }
                resolve(this._bucket.openDownloadStream(file._id))
            })
        })

    }
    /**
     * @description Lets the user download the folder specified in the `folderPath` parameter as a zip file. The form which the zip file is returned varies
     * based on the argument provided for the returnType parameter.
     * @param {string} folderPath String representing the absolute path of the folder
     * @param {string} returnType String specifying the form in which the zip file of the target folder should be returned. Valid options are 'base64',
     * 'nodebuffer' (NodeJS buffer), 'array' (array of bytes (numbers between 255 and 0)), 'uint8array','arraybuffer', 'blob', and 'binarystring'.
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * //Returns an array of bytes (numbers between 255 and 0) representing the data of the zip file
     * let zip = await fileTree.downloadFolder("sample-folder/subfolder-sample", "array")
     */
    downloadFolder(folderPath: string, returnType: OutputType){
        return new Promise<Buffer|Uint8Array|string|Blob|number[]|ArrayBuffer>((resolve, reject)=>{
            this._client.connect(async ()=>{
                const folderZip = new JSZip()

                const downloadAsync = async (file: GridFSFile): Promise<void> =>{
                    return new Promise<void>((resolveFileDownload)=>{
                        const downloadStream = this._bucket.openDownloadStream(file._id)
                        let data = ''
                        downloadStream.on("data",(chunk)=>{
                            data+=chunk.toString("base64")
                        })
                        downloadStream.on("end",()=>{
                            folderZip.file(file.metadata?.path.slice(folderPath.length+1), data, {createFolders:true, base64:true})
                            resolveFileDownload()
                        })
                    })
                }

                const topFolder = await this._db.collection(this._folderCollectionName).findOne({"path":folderPath})

                if(!topFolder && folderPath !== this._folderCollectionName){
                    return reject(new Error(`Folder with path ${folderPath} does not exist`))
                }

                if(!['base64','nodebuffer', 'array', 'uint8array','arraybuffer', 'blob', 'binarystring'].includes(returnType)){
                    return reject(new Error(`Invalid argument for parameter returnType. Argument must either be 'base64','nodebuffer', 'array', 'uint8array','arraybuffer', 'blob', or 'binarystring'.`))
                }

                const allFiles: GridFSFile[] = await this._bucket.find({"metadata.isLatest":true, "metadata.parentDirectory":new RegExp("^"+folderPath)}).toArray()


                for(const file of allFiles){
                    await downloadAsync(file)
                }
                return resolve(await folderZip.generateAsync({type:returnType}))
            })
        })
    }
    /**
     * @description Upload a file to the GridFS Bucket file tree, with the parent directory of the file being
     * the current working directory of the file tree.
     * If a file with the name provided to the method from the `options` parameter already exists
     * in the current working directory of the file tree,
     * the uploaded file will be treated as the latest version of that file, with the
     * `isLatest` metadata property of the uploaded file being true and the `isLatest` property of the
     * previous file being set to false.
     * @param {Readable} fileStream Valid readable stream
     * @param {FileOptions} options Options for the file. Mandatory properties are `name` and `chunkSize`
     * (the size of the chunks of the file in GridFS in bytes).
     * The `customMetadata` property is optional.
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * // id of the file in file tree GridFS bucket
     * let id = await fileTree.uploadFile(fs.createReadStream("sample.txt"), {name:"sample.txt", chunkSize:1048576, customMetadata:{favourite:true}})
     */
    uploadFile(fileStream: Readable, options: FileOptions){
        return new Promise<ObjectId>((resolve, reject)=>{
            if (!(fileStream instanceof Readable)){
                return reject(new Error("Argument for parameter fileStream is not a valid readable stream"))
            }

            if(!options.name){
                return reject(new Error("Missing 'name' property for 'options' parameter."))
            }

            if(!options.chunkSize){
                return reject(new Error("Missing 'chunkSize' property for 'options' parameter."))
            }

            if(options.name.match(/\\|[/$%?@"'!$><\s*&{}#=`|:+]/)){
                // @ts-ignore
                return reject(new Error(`Character "${options.name.match(/\\|[/$%?@"'!$><\s*&{}#=`|:+]/)[0]}" cannot be used as part of a file name`))
            }

            const path = this.currentWorkingDirectory+`/${options.name}`

            this._client.connect(()=>{
                this._db.collection(this._bucketName+".files").findOneAndUpdate({"metadata.path":path, "metadata.isLatest":true},{$set:{"metadata.isLatest":false}})
                const uploadStream = this._bucket.openUploadStream(options.name, {

                    chunkSizeBytes:options.chunkSize,

                    metadata:{
                        parentDirectory:this.currentWorkingDirectory,
                        path,
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
     * @description Change the name of a file in the file tree. This also changes its `path` metadata property accordingly.
     * @param {string} newName New name for the file
     * @param {string} filePath Absolute path of the file that you want to change the name of
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.changeFileName("new-file-name", "sample-folder/old-file-name.txt") //File now has path sample-folder/new-file-name.txt
     */
     changeFileName(newName:string, filePath:string){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async ()=>{
                const allFileVersions = this._bucket.find({"metadata.path":filePath})

                if(!(await allFileVersions.hasNext())){
                    return reject(new Error(`File with path ${filePath} does not exist`))
                }

                if(newName.match(/\\|[/$%?@"'!$><\s*&{}#=`|:+]/)){
                    // @ts-ignore
                    return reject(new Error(`Character "${newName.match(/\\|[/$%?@"'!$><\s*&{}#=`|:+]/)[0]}" cannot be used as part of a file name`))
                }

                const parentDirectory = (await allFileVersions.next())?.metadata?.parentDirectory
                await this._db.collection(this.bucketName+".files").updateMany({"metadata.path":filePath},{$set:{"metadata.path":parentDirectory+`/${newName}`, "filename":newName}})

                resolve()
            })

        })
    }

    /**
     * @description Update the metadata of a file in the file tree, allowing users to add, change, or delete metadata properties from files.
     * Raises an error if the user tries to change or delete the 'path', 'parentDirectory', or 'isLatest' metadata properties from a file.
     * @param {string} filePath Absolute path of the file that you want to change the metadata of
     * @param {MetadataOptions} newMetadata Metadata properties to add or change the value of. Can have any property except the ones listed above.
     * @param {Array<string>} deleteFields Metadata properties to delete. Can include any property except the ones listed above.
     * @param {boolean} changeForAllVersions If false, only changes metadata properties for latest version of file.
     * If true, changes metadata properties for all versions of the file. Defaults to false.
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.changeFileMetadata("sample-folder/sample.txt", {favourite:true}, ["sample-property"], true)
     */
     changeFileMetadata(filePath: string, newMetadata?:MetadataOptions, deleteFields?:string[], changeForAllVersions: boolean= false){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async ()=>{
                // @ts-ignore
                if(newMetadata?.path || deleteFields?.includes('path')){
                    return reject(new Error("Cannot change or delete 'path' metadata property using this method" ))
                }
                // @ts-ignore
                if(newMetadata?.parentDirectory|| deleteFields?.includes('parentDirectory')){
                    return reject(new Error("Cannot change or delete 'parentDirectory' metadata property using this method" ))
                }
                // @ts-ignore
                if(newMetadata?.isLatest || deleteFields?.includes('isLatest')){
                    return reject(new Error("Cannot delete or change the type of 'isLatest' metadata property using this method" ))
                }
                if(changeForAllVersions){
                    if(newMetadata){
                        const fields: any = {}
                        Object.keys(newMetadata).forEach((field: string)=>{
                            // @ts-ignore
                            fields["metadata."+field] = newMetadata[field]
                        })
                        await this._db.collection(this._bucketName+".files").updateMany({"metadata.path":filePath},{$set:fields})
                    }
                    if(deleteFields){

                        const fields: any = {}
                        deleteFields.forEach((field: string)=>{
                            // @ts-ignore
                            fields["metadata."+field] = ""
                        })
                        await this._db.collection(this._bucketName+".files").updateMany({"metadata.path":filePath},{$unset:fields})
                    }
                }
                else{
                    if(newMetadata){
                        const fields: any = {}
                        Object.keys(newMetadata).forEach((field: string)=>{
                            // @ts-ignore
                            fields["metadata."+field] = newMetadata[field]
                        })
                        await this._db.collection(this._bucketName+".files").findOneAndUpdate({"metadata.isLatest":true,"metadata.path":filePath},{$set:fields})
                    }
                    if(deleteFields){

                        const fields: any = {}
                        deleteFields.forEach((field: string)=>{
                            // @ts-ignore
                            fields["metadata."+field] = ""
                        })
                        await this._db.collection(this._bucketName+".files").findOneAndUpdate({"metadata.isLatest":true,"metadata.path":filePath},{$unset:fields})
                    }
                }
                resolve()
            })

        })
    }
    /**
     * @description Update the metadata of a folder in the file tree, allowing users to add, change, or delete metadata properties from folders.
     * Raises an error if the user tries to change or delete the 'path' and 'parentDirectory' properties from a folder.
     * @param {string} folderPath Absolute path of the folder that you want to change the name of
     * @param {MetadataOptions} newMetadata Metadata properties to add or change the value of. Can have any property except the ones listed above.
     * @param {Array<string>} deleteFields Metadata properties to delete. Can have any property except the ones listed above.
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.changeFolderMetadata("sample-folder/subfolder", {favorite:true}, ["sample-property"])
     */
    changeFolderMetadata(folderPath: string, newMetadata?:MetadataOptions, deleteFields?:string[]){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async ()=>{
                // @ts-ignore
                if(newMetadata?.path || deleteFields?.includes('path')){
                    return reject(new Error("Cannot change or delete 'path' metadata property using this method" ))
                }
                // @ts-ignore
                if(newMetadata?.parentDirectory|| deleteFields?.includes('parentDirectory')){
                    return reject(new Error("Cannot change or delete 'parentDirectory' metadata property using this method" ))
                }
                // @ts-ignore
                if(newMetadata?.isLatest || deleteFields?.includes('isLatest')){
                    return reject(new Error("Cannot add or delete 'isLatest' metadata property for a folder" ))
                }

                if(newMetadata){
                    const fields: any = {}
                    Object.keys(newMetadata).forEach((field: string)=>{
                        // @ts-ignore
                        fields["customMetadata."+field] = newMetadata[field]
                    })
                    await this._db.collection(this._folderCollectionName).findOneAndUpdate({"path":folderPath},{$set:fields})
                }

                if(deleteFields){
                    const fields: any = {}
                    deleteFields.forEach((field: string)=>{
                        fields["customMetadata."+field] = ""
                    })
                    await this._db.collection(this._folderCollectionName).findOneAndUpdate({"path":folderPath},{$unset:fields})
                }
                resolve()
            })

        })
    }

    /**
     * @description Change the name of a folder in the file tree. This also changes its `path` metadata property accordingly,
     * and the `path` and `parentDirectory` metadata property of all subfolders and files in the folder. Raises an error
     * if the specified folder does not exist.
     * @param {string} newName New name for the file
     * @param {string} folderPath Absolute path of the folder that you want to change the name of
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.changeFolderName("new-folder-name", "sample-folder/sample-folder-2")
     */
    changeFolderName(newName:string, folderPath:string){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async ()=>{

                if(folderPath === this._folderCollectionName){
                    return reject(new Error(`Cannot rename root directory of the file tree`))
                }

                const topFolder = await this._db.collection(this._folderCollectionName).findOne({"path":folderPath})

                let newPath: string

                if(!topFolder && folderPath !== this._folderCollectionName){
                    return reject(new Error(`Folder with path ${folderPath} does not exist`))
                }

                const doesFolderExist = Boolean(await this._db.collection(this._folderCollectionName).findOne({"path":topFolder?.parentDirectory+`/${newName}`}))

                if(doesFolderExist){
                    return reject(new Error(`Folder with name ${newName} already exists in the current directory`))
                }

                newPath = topFolder?.parentDirectory+`/${newName}`

                if(newName.match(/\\|[/$%?@"'!$><\s*&{}#=`|:+]/)){
                    // @ts-ignore
                    const errSymbol = newName.match(/\\|[/$%?@"'!$><\s*&{}#=`|:+]/)[0]
                    return reject(new Error(`Character "${errSymbol}" cannot be used as part of a folder name`))
                }

                await this._db.collection(this._folderCollectionName).updateOne({"path":folderPath},{$set:{"path":newPath, "name":newName}})
                await this._db.collection(this._folderCollectionName).updateMany({"parentDirectory":new RegExp("^"+folderPath)},
                [{$set:{"path":
                {$replaceOne:{
                    input:"$path",
                    find:folderPath,
                    replacement:newPath}},
                "parentDirectory":
                {$replaceOne:{
                    input:"$parentDirectory",
                    find:folderPath,
                    replacement:newPath}},
                "name":newName
                }}])

                await this._db.collection(this._bucketName+'.files').updateMany({"metadata.parentDirectory":new RegExp("^"+folderPath)},
                [{$set:{"metadata.path":
                {$replaceOne:{
                    input:"$metadata.path",
                    find:folderPath,
                    replacement:newPath}},
                "metadata.parentDirectory":
                {$replaceOne:{
                    input:"$metadata.parentDirectory",
                    find:folderPath,
                    replacement:newPath}}
                }}])

                resolve()
            })

        })
    }

    /**
     * @description Changes the current working directory of the file tree to the absolute path of the directory
     * specified by the `path` parameter, which is the folder where files uploaded by the `uploadFile` method and where new folders
     * created by the `createFolder` method will be located. Will raise an error if a directory with
     * the specified path does not exist.
     * @param {string} path If parameter `isRelative` is false, or not provided, `path` should be a
     * string representing the absolute path of a directory that exists in the collection specified by the
     * `folderCollectionName` property. If parameter `isRelative` is true, `path` is assumed to be relative
     * to the current working directory. The 'root directory' will have the same name as the `folderCollectionName`
     * property.
     * @param {boolean} isRelative If true, parameter `path` must be relative to the current working directory. If false, which is the default value,
     * parameter `path` must be the absolute path of a file.
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * //Absolute path, current working directory is now "sample-folder/subfolder-sample"
     * await fileTree.changeDirectory("sample-folder/subfolder-sample")
     * //Relative path; absolute path of current working directory is now "sample-folder/subfolder-sample/subfolder-sample-2"
     * await fileTree.changeDirectory("subfolder-sample-2", true)
     */
    changeDirectory(path: string, isRelative: boolean = false){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async ()=>{
                let absolutePath
                if(!isRelative){
                    absolutePath = path
                }
                else{
                    absolutePath = this._currentWorkingDirectory+"/"+path
                }
                const folder = await this._db.collection(this._folderCollectionName).findOne({"path":absolutePath})
                if(folder || absolutePath === this._folderCollectionName){
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
     * @description Deletes a folder from the file tree, including all versions of the files in it and its subfolders.
     * If current working directory is about to be deleted, and it is not the root directory, raises en error.
     * @param {string} folderPath Absolute path of a folder that exists in the collection
     * specified by the `folderCollectionName` property, or the name of the folder storage collection (`folderCollectionName`)
     * If `folderPath` is the same as `folderCollectionName`, the collection is not deleted, but all documents in it and
     * files in the associated GridFS bucket of the file tree will still be deleted.
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.deleteFolder("sample-folder/subfolder-sample")
     */
    deleteFolder(folderPath: string){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async()=>{

                if(this._currentWorkingDirectory.match(folderPath) && folderPath !== this._folderCollectionName ){
                    return reject(new Error(`Cannot delete current working directory (${this._currentWorkingDirectory})`))
                }

                const topFolder = await this._db.collection(this._folderCollectionName).findOne({"path":folderPath})

                if(!topFolder && folderPath !== this._folderCollectionName){
                    return reject(new Error(`Folder with path ${folderPath} does not exist`))
                }

                const allFiles: GridFSFile[] = await this._bucket.find({"metadata.isLatest":true, "metadata.parentDirectory":new RegExp("^"+folderPath)}).toArray()


                for(const file of allFiles){
                    await this.deleteFile(file.metadata?.path)
                }
                await this._db.collection(this._folderCollectionName).deleteMany({"parentDirectory":new RegExp("^"+folderPath)})

                if(folderPath !== this._folderCollectionName){
                    await this._db.collection(this._folderCollectionName).deleteOne({"path":folderPath})
                }

                resolve()
            })
        })
    }
    /**
     * @description Deletes all the versions of a file from the GridFS bucket of the file tree.
     * @param {string} filePath Absolute path to a file that exists in the bucket specified by the `bucket`
     * property on the `FileTree` class
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.deleteFile("sample-folder/sample.txt")
     */
    deleteFile(filePath: string){
        return new Promise<void>((resolve, reject)=>{
            this._client.connect(async ()=>{
                const allFileVersions = this._bucket.find({"metadata.path":filePath})
                if(!(await allFileVersions.hasNext())){
                    return reject(new Error(`File with path ${filePath} does not exist`))
                }

                const allFileVersionsArr = await allFileVersions.toArray()
                for(const file of allFileVersionsArr){
                    await this._bucket.delete(file._id)
                }
                resolve()
            })
        })
    }
}

export default MongoFileTree
export {FileOptions, MetadataOptions}