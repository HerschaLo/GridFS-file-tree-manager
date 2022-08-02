/// <reference types="node" />
/// <reference types="node" />
import { MongoClient, GridFSBucket, Db, ObjectId, InsertOneResult, GridFSBucketReadStream } from "mongodb";
import { Readable } from "stream";
import { OutputType } from "jszip";
/**
 * Shape of the object to be provided as an argument for the `options` parameter
 * of the `uploadFile` method on the MongoFileTree class.
 */
interface FileOptions {
    /** Name of the file being uploaded  */
    name: string;
    /** Size of the file chunks in GridFS */
    chunkSize: number;
    /** Custom metadata properties to add to the file. Any property can be added besides 'path', 'parentDirectory', and 'isLatest' can be added. Is optional.  */
    customMetadata?: MetadataOptions;
}
/**
 * Object type representing custom metadata that the user can add to folders and files.
 * Can have any property except 'path', 'parentDirectory', and 'isLatest'.
 * This prevents users from improperly modifying these properties using class methods, as they
 * are critical to the basic functioning of the file tree.
 */
declare type MetadataOptions = Omit<object, "path" | "parentDirectory" | "isLatest">;
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
    "parentDirectory":<string>, //Absolute path of the folder where the file is located
    "path":<string>, //Absolute path of the file
    "isLatest":<boolean>, //Is this the latest version of the file or not
     ...
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
 * Note: this class automatically connects to MongoDB for all methods. */
declare class MongoFileTree {
    private _currentWorkingDirectory;
    private _bucket;
    private _db;
    private _folderCollectionName;
    private _client;
    private _bucketName;
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
    constructor(mongoConnectionUrl: string, dbName: string, bucketName: string, folderCollectionName: string);
    /**
     * Mongo database storing the file tree.
     */
    get db(): Db;
    /**
     * GridFS bucket that stores the files of the file tree.
     */
    get bucket(): GridFSBucket;
    /**
     * Name of the GridFS bucket that stores the files of the file tree.
     */
    get bucketName(): string;
    /**
     * Name of the collection in the Mongo database specified by dbName
     * that will be used for folder storage, storing documents representing folders in the file tree.
     */
    get folderCollectionName(): string;
    /**
     * Absolute path of the current working directory of the file tree.
     * This directory is where the files uploaded by the uploadFile method
     * and the folders created by the createFolder method will be located.
     */
    get currentWorkingDirectory(): string;
    /**
     * MongoDB client being used for the file tree.
     */
    get client(): MongoClient;
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
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * //Creates new folder with path sample-folder/subfolder-sample
     * let result = await fileTree.createFolder("subfolder-sample") //MongoDB InsertOneResult with the id of the document representing the folder
     */
    createFolder(folderName: string, customMetadata?: MetadataOptions): Promise<InsertOneResult<import("bson").Document>>;
    /**
     * @description Returns a promise which resolves to a `GridFSBucketReadStream` of a file stored in the
     * GridFS Bucket specified by the `bucketName` property.
     * @param {string} filePath Absolute path of the file to get a readable stream of
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * let stream = await fileTree.getFileReadStream("sample-folder/sample.txt")
     */
    getFileReadStream(filePath: string): Promise<GridFSBucketReadStream>;
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
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * //Returns an array of bytes (numbers between 255 and 0) representing the data of the zip file
     * let zip = await fileTree.downloadFolder("sample-folder/subfolder-sample", "array")
     */
    downloadFolder(folderPath: string, returnType: OutputType): Promise<String | Buffer | Uint8Array | Blob | ArrayBuffer | Number[]>;
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
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * // id of the file in file tree GridFS bucket
     * let id = await fileTree.uploadFile(fs.createReadStream("sample.txt"), {name:"sample.txt", chunkSize:1048576, customMetadata:{favourite:true}})
     */
    uploadFile(fileStream: Readable, options: FileOptions): Promise<ObjectId>;
    /**
     * @description Change the name of a file in the file tree. This also changes its `path` metadata property accordingly.
     * @param {string} newName New name for the file
     * @param {string} filePath Absolute path of the file that you want to change the name of
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.changeFileName("new-file-name", "sample-folder/old-file-name.txt") //File now has path sample-folder/new-file-name.txt
     */
    changeFileName(newName: string, filePath: string): Promise<void>;
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
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.changeFileMetadata("sample-folder/sample.txt", {favourite:true}, ["sample-property"], true)
     */
    changeFileMetadata(filePath: string, newMetadata?: MetadataOptions, deleteFields?: Array<string>, changeForAllVersions?: boolean): Promise<void>;
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
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.changeFolderMetadata("sample-folder/subfolder", {favorite:true}, ["sample-property"])
     */
    changeFolderMetadata(folderPath: string, newMetadata?: MetadataOptions, deleteFields?: Array<string>): Promise<void>;
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
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.changeFolderName("new-folder-name", "sample-folder/sample-folder-2")
     */
    changeFolderName(newName: string, folderPath: string): Promise<void>;
    /**
     * @description Changes the current working directory of the folder system to the absolute path of the directory
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
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * //Absolute path, current working directory is now "sample-folder/subfolder-sample"
     * await fileTree.changeDirectory("sample-folder/subfolder-sample")
     * //Relative path; absolute path of current working directory is now "sample-folder/subfolder-sample/subfolder-sample-2"
     * await fileTree.changeDirectory("subfolder-sample-2", true)
     */
    changeDirectory(path: string, isRelative?: boolean): Promise<void>;
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
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.deleteFolder("sample-folder/subfolder-sample")
     */
    deleteFolder(folderPath: string): Promise<void>;
    /**
     * @description Deletes all the versions of a file from the GridFS bucket of the file tree.
     * @param {string} filePath Absolute path to a file that exists in the bucket specified by the `bucket`
     * property on the `FileTree` class
     * @since 1.0.0
     * @version 0.1.0
     * @example
     *
     * const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-system-management-sample", "sample-bucket", "sample-folder")
     * await fileTree.deleteFile("sample-folder/sample.txt")
     */
    deleteFile(filePath: string): Promise<void>;
}
export default MongoFileTree;
export { FileOptions, MetadataOptions };
