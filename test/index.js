var testDatabase = require('./util/database');
var db = require('../')(testDatabase.url);
var uniqn = require('./util/ponies').uniqn;

var assert = require('assert');
var async = require('async');

describe('seraph#index', function() {
  it('should create an index on a key', function(done) {
    var labelname = uniqn();
    db.index.create(labelname, 'name', function(err, index) {
      assert(!err);
      assert.equal(index.label, labelname);
      assert.equal(index.property_keys.length, 1);
      assert.equal(index.property_keys[0], 'name');
      done();
    });
  });

  it('should list indexes for a label', function(done) {
    var labelname = uniqn();
    db.index.create(labelname, 'name', function(err, index) {
      assert(!err);
      db.index.indexes(labelname, function(err, indexes) {
        assert(!err);
        assert.equal(indexes.length, 1);
        assert.equal(indexes[0].label, labelname);
        assert.equal(indexes[0].property_keys.length, 1);
        assert.equal(indexes[0].property_keys[0], 'name');
        done();
      });
    });
  });
});
