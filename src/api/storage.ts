import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { UploadContentType } from '../shared/schema.js';
import type { AppConfig } from './env.js';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES: UploadContentType[] = ['application/pdf', 'image/jpeg', 'image/png'];

export interface PrivateStorage {
  upload(path: string, body: Uint8Array, contentType: UploadContentType): Promise<void>;
  createReadUrl(path: string, expiresInSeconds: number): Promise<string>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  createBucketIfMissing(): Promise<void>;
}

export class SupabasePrivateStorage implements PrivateStorage {
  private readonly client: SupabaseClient;

  constructor(private readonly config: AppConfig) {
    this.client = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async upload(path: string, body: Uint8Array, contentType: UploadContentType): Promise<void> {
    const { error } = await this.client.storage.from(this.config.OBJECT_STORAGE_BUCKET).upload(path, body, {
      contentType,
      cacheControl: '0',
      upsert: false,
    });
    if (error) throw new Error('Unable to store the private document.');
  }

  async createReadUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage.from(this.config.OBJECT_STORAGE_BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) throw new Error('Unable to create a temporary document access URL.');
    return data.signedUrl;
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage.from(this.config.OBJECT_STORAGE_BUCKET).remove([path]);
    if (error) throw new Error('Unable to delete the private document.');
  }

  async exists(path: string): Promise<boolean> {
    const slash = path.lastIndexOf('/');
    const folder = slash === -1 ? '' : path.slice(0, slash);
    const name = slash === -1 ? path : path.slice(slash + 1);
    const { data, error } = await this.client.storage.from(this.config.OBJECT_STORAGE_BUCKET).list(folder, {
      search: name,
      limit: 10,
    });
    if (error) throw new Error('Unable to inspect private object storage.');
    return data.some((object) => object.name === name);
  }

  async createBucketIfMissing(): Promise<void> {
    const expected = {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE_BYTES,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    };
    const { data: existing, error: listError } = await this.client.storage.listBuckets();
    if (listError) throw new Error('Unable to inspect private object storage.');
    if (existing.some((bucket) => bucket.id === this.config.OBJECT_STORAGE_BUCKET)) {
      const { error } = await this.client.storage.updateBucket(this.config.OBJECT_STORAGE_BUCKET, expected);
      if (error) throw new Error('Unable to enforce private object-storage policy.');
    } else {
      const { error } = await this.client.storage.createBucket(this.config.OBJECT_STORAGE_BUCKET, expected);
      if (error) throw new Error('Unable to create private object storage.');
    }
    const { data: verified, error: verifyError } = await this.client.storage.getBucket(this.config.OBJECT_STORAGE_BUCKET);
    if (
      verifyError
      || !verified
      || verified.public
      || Number(verified.file_size_limit) !== MAX_FILE_SIZE_BYTES
      || [...(verified.allowed_mime_types ?? [])].sort().join('|') !== [...ALLOWED_MIME_TYPES].sort().join('|')
    ) {
      throw new Error('Private object-storage policy could not be verified.');
    }
  }
}

export class InMemoryPrivateStorage implements PrivateStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: UploadContentType }>();
  readonly deleted: string[] = [];
  failNextUpload = false;
  failNextRemove = false;

  async upload(path: string, body: Uint8Array, contentType: UploadContentType): Promise<void> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error('Synthetic upload failure.');
    }
    if (this.objects.has(path)) throw new Error('Object already exists.');
    this.objects.set(path, { body: Uint8Array.from(body), contentType });
  }
  async createReadUrl(path: string): Promise<string> {
    if (!this.objects.has(path)) throw new Error('Object not found.');
    return `https://storage.test/${path}`;
  }
  async remove(path: string): Promise<void> {
    if (this.failNextRemove) {
      this.failNextRemove = false;
      throw new Error('Synthetic cleanup failure.');
    }
    this.objects.delete(path);
    this.deleted.push(path);
  }
  async exists(path: string): Promise<boolean> { return this.objects.has(path); }
  async createBucketIfMissing(): Promise<void> { /* test adapter */ }
}
