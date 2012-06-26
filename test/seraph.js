/* -*- Mode: Javascript; js-indent-level: 2 -*- */

/**
 * Goal: Seraph 1.0
 * 
 * x db.call(path, [method='get'], [data], callback);
 * x db.save(obj, [callback]);
 * x db.relate(obj|id, linkname, other_obj|id, [props], [callback]);
 * x db.query(query, [params], callback);
 * x db.find(predicate, [indexes], callback);
 * x db.delete(obj, [callback]);
 * x db.read(obj|id, callback);
 * x db.relationships(obj|id, [name], [direction], callback);
 * x db.readLink(linkId, callback);
 * db.addIndex(obj|id, indexName, indexKey, indexValue, [callback])
 * db.readIndex(indexName, indexKey, [indexValue], callback)
 * db.indexes(obj|id, callback);
 * db.traversal(traversal, callback);
 *
 * **/

var TEST_INSTANCE_PORT = parseInt('10507' || process.env.TEST_INSTANCE_PORT, 10);

var seraph = require('../');
var db = seraph.db('http://localhost:' + TEST_INSTANCE_PORT);
var spawn = require('child_process').spawn;

var async = require('async');
var naan = require('naan');
var assert = require('assert');
var path = require('path');
var fs = require('fs');

var neo4j = path.join(__dirname, '../db/bin/neo4j');
var neo4jconf = path.join(__dirname, '../db/conf/neo4j-server.properties');
var datapath = path.join(__dirname, '../db/data');

var counter = (function() {
  var count = Date.now();
  return function() {
    return ++count;
  };
})();

var uniqn = function() { return 'identity' + counter(); };

var updateConf = function(port, done) {
  var readConf = naan.curry(fs.readFile, neo4jconf, 'utf8');
  var writeConf = naan.curry(fs.writeFile, neo4jconf);
  var setPorts = function(confData, callback) {
    callback(null, confData
      .replace(/(webserver\.port=)(\d+)/gi, '$1' + port)
      .replace(/(https\.port=)(\d+)/gi, '$1' + (port + 1))
    );
  }
  async.waterfall([readConf, setPorts, writeConf], done);
}

var refreshDb = function(done) {
  if (process.env.USE_DIRTY_DATABASE === 'true') {
    return done();
  }
  async.series([
    function(next) {
      spawn(neo4j, ['stop']).on('exit', function() { next(); })
    },
    function(next) {
      spawn('rm', ['-rf', datapath]).on('exit', function() { next(); });
    },
    function(next) {
      spawn('mkdir', ['-p', datapath]).on('exit', function() { next(); });
    },
    function(next) {
      updateConf(TEST_INSTANCE_PORT, next);
    },
    function(next) {
      var n = spawn(neo4j, ['start'])
      n.stdout.on('data', function(d) { 
        process.stdout.write(d.toString()); 
      })
      n.on('exit', function() { console.log(''); next(); });
    }, 
    function(next) {
      setTimeout(function() { next(); }, 1000);
    }
  ], done);
};

var stopDb = function(done) {
  if (process.env.NO_STOP === 'true') {
    return done();
  }

  var n = spawn(neo4j, ['stop'])
  n.stdout.on('data', function(d) { 
    process.stdout.write(d.toString()); 
  })
  n.on('exit', function() { console.log(''); done(); });
}

before(refreshDb);
after(stopDb);

describe('seraph#call, seraph#operation', function() {
  var originalRequest = seraph.call._request;
  function setupMock(mock) {
    seraph._request = mock;
  };
  afterEach(function() {
    seraph._request = originalRequest;
  });
  
  it('should infer GET request if no data or method supplied', function(done) {
    var opts = { endpoint: '' };
    setupMock(function(opts, callback) {
      assert.ok(typeof callback === 'function');
      assert.equal(opts.method, 'GET');
      done();
    });
    var op = seraph.operation(opts, '');
    seraph.call(opts, op);
  });

  it('should infer POST request if data supplied', function(done) {
    var opts = { endpoint: '' };
    var testObject = {
      foo: 'foo',
      bar: 10
    };
    setupMock(function(opts, callback) {
      assert.ok(typeof callback === 'function');
      assert.equal(opts.method, 'POST');
      assert.deepEqual(opts.json, testObject);
      done();
    });
    var op = seraph.operation(opts, '', testObject);
    seraph.call(opts, op);
  });

  it('should add /db/data/ to url', function(done) {
    var opts = { endpoint: '' };
    var obj = {};
    setupMock(function(opts, callback) {
      assert.equal(opts.uri, '/db/data/');
      done();
    });
    var op = seraph.operation(opts, '', obj);
    seraph.call(opts, op);
  });
});

describe('seraph#save, seraph#read', function() {
  it('should be able to create an object and read it back', function(done) {
    function create(done) {
      db.save({ name: 'Jon', age: 23 }, function(err, user) {
        assert.ok(!err, err);
        assert.ok(typeof user.id !== 'undefined');
        assert.equal(user.name, 'Jon');
        assert.equal(user.age, 23);

        done(null, user.id);
      });
    }

    function read(userId, done) {
      db.read(userId, function(err, user) {
        assert.ok(!err, err);
        assert.equal(user.name, 'Jon');
        assert.equal(user.age, 23);
        done(null, user);
      });
    }

    async.waterfall([create, read], done);
  });

  it('should take an array of objects to save/read', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon'}, {name: 'Helge'}], function(err, users) {
        assert.ok(!err, err);
        assert.equal(users[0].name, 'Jon');
        assert.equal(users[1].name, 'Helge');
        done(null, users[0], users[1]);
      });
    }

    function readObjs(user1, user2, done) {
      db.read([user1.id, user2.id], function(err, users) {
        assert.ok(!err, err);
        assert.equal(users[0].name, 'Jon');
        assert.equal(users[1].name, 'Helge');
        done();
      });
    }

    async.waterfall([createObjs, readObjs], done);
  });
})

describe('seraph#update', function() {
  it('should perform an update on an object', function(done) {
    function create(done) {
      db.save({ name: 'Jan', age: 55 }, function(err, user) {
        assert.ok(!err);
        assert.equal(user.name, 'Jan');
        assert.equal(user.age, 55);
        done(null, user);
      });
    }

    function update(user, done) {
      user.name = 'Belinda';
      user.age = 26;
      var userId = user.id;
      db.save(user, function(err, user) {
        assert.ok(!err);
        assert.equal(userId, user.id);
        assert.equal(user.name, 'Belinda');
        assert.equal(user.age, 26);
        db.read(userId, function(err, user) {
          assert.ok(!err);
          assert.equal(userId, user.id);
          assert.equal(user.name, 'Belinda');
          assert.equal(user.age, 26);
          done(null, user);
        });
      });
    }

    async.waterfall([create, update], done);
  });

  it('should take an array of objects to save/read', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon'}, {name: 'Helge'}], function(err, users) {
        assert.ok(!err);
        assert.equal(users[0].name, 'Jon');
        assert.equal(users[1].name, 'Helge');
        done(null, users[0], users[1]);
      });
    }

    function readObjs(user1, user2, done) {
      db.read([user1.id, user2.id], function(err, users) {
        assert.ok(!err);
        assert.equal(users[0].name, 'Jon');
        assert.equal(users[1].name, 'Helge');
        done(null, users[0], users[1]);
      });
    }

    function updateObjs(user1, user2, done) {
      user1.name = 'Bertin';
      user2.name = 'Erlend';
      db.save([user1, user2], function(err, users) {
        assert.ok(!err);
        assert.equal(users[0].name, 'Bertin');
        assert.equal(users[1].name, 'Erlend');
        done();
      });
    }

    async.waterfall([createObjs, readObjs, updateObjs], done);
  });
});

describe('seraph#delete', function() {
  it('should delete an object', function(done) {
    function create(done) {
      db.save({ name: 'Neil', age: 61 }, function(err, user) {
        assert.ok(!err);
        assert.equal(user.name, 'Neil');
        assert.equal(user.age, 61);
        done(null, user);
      });
    }

    function del(user, done) {
      db.delete(user, function(err) {
         assert.ok(!err);
        db.read(user, function(err) {
          assert.ok(!!err);
          done();
        });
      });
    }

    async.waterfall([create, del], done);
  });

  it('should take an array of objects to delete', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon'}, {name: 'Helge'}], function(err, users) {
        assert.ok(!err);
        assert.equal(users[0].name, 'Jon');
        assert.equal(users[1].name, 'Helge');
        done(null, users[0], users[1]);
      });
    }

    function readObjs(user1, user2, done) {
      db.read([user1.id, user2.id], function(err, users) {
        assert.ok(!err);
        assert.equal(users[0].name, 'Jon');
        assert.equal(users[1].name, 'Helge');
        done(null, users[0], users[1]);
      });
    }

    function delObjs(user1, user2, done) {
      db.delete([user1.id, user2.id], function(err) {
        assert.ok(!err);
        db.read([user1.id, user2.id], function(err) {
          assert.ok(!!err);
          done();
        });
      });
    }

    async.waterfall([createObjs, readObjs, delObjs], done);
  });
});

describe('seraph.rel', function() {
  it('should link two objects together', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon'}, {name: 'Helge'}], function(err, users) {
        assert.ok(!err);
        assert.equal(users[0].name, 'Jon');
        assert.equal(users[1].name, 'Helge');
        done(null, users[0], users[1]);
      });
    }

    function linkObjs(user1, user2, done) {
      db.rel.create(user1, 'coworker', user2, function(err, link) {
        assert.ok(!err);
        assert.equal(link.start, user1.id);
        assert.equal(link.end, user2.id);
        assert.equal(link.type, 'coworker');
        assert.deepEqual(link.properties, {});
        assert.ok(link.id != null);
        done(null, link, user1, user2);
      });
    }

    function readLink(link, user1, user2, done) {
      var linkId = link.id;
      db.rel.read(link.id, function(err, link) {
        assert.ok(!err, err);
        assert.equal(link.start, user1.id);
        assert.equal(link.end, user2.id);
        assert.equal(link.type, 'coworker');
        assert.deepEqual(link.properties, {});
        assert.equal(linkId, link.id);
        done(null);
      });
    }

    async.waterfall([createObjs, linkObjs, readLink], done);
  });

  it('should link two objects with props on the link', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon'}, {name: 'Helge'}], function(err, users) {
        done(null, users[0], users[1]);
      });
    }

    function linkObjs(user1, user2, done) {
      db.rel.create(user1, 'coworker', user2, {
        prop: 'test'
      }, function(err, link) {
        assert.ok(!err);
        assert.deepEqual(link.properties, {prop: 'test'});
        done(null, link);
      });
    }

    function readLink(link, done) {
      var linkId = link.id;
      db.rel.read(link.id, function(err, link) {
        assert.deepEqual(link.properties, {prop: 'test'});
        done(null);
      });
    }

    async.waterfall([createObjs, linkObjs, readLink], done);
  });

  it('should update the properties of a link', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon'}, {name: 'Helge'}], function(err, users) {
        done(null, users[0], users[1]);
      });
    }

    function linkObjs(user1, user2, done) {
      db.rel.create(user1, 'coworker', user2, {
        prop: 'test',
        anotherProp: 'test2',
        thirdProp: 'test3'
      }, function(err, link) {
        done(null, link);
      });
    }

    function updateLink(link, done) {
      link.properties.newProp = 'test4';
      delete link.properties.thirdProp;
      db.rel.update(link, function(err) {
        assert.ok(!err);
        done(null, link);
      });
    }

    function readLink(link, done) {
      var linkId = link.id;
      db.rel.read(link.id, function(err, link) {
        assert.deepEqual(link.properties, {
          prop: 'test',
          anotherProp: 'test2',
          newProp: 'test4'
        });
        done(null);
      });
    }

    async.waterfall([createObjs, linkObjs, updateLink, readLink], done);
  });
});

describe('seraph#links', function() {
  function createObjs(done) {
    var create = naan.curry(db.save, [
      {name: 'Jon'},
      {name: 'Helge'},
      {name: 'Bertin'}
    ]);
    var link = function(users, callback) {
      var knows = naan.curry(db.relate, users[0], 'knows', users[1], {
        since: 'January'
      });
      var coworker = naan.curry(db.relate, users[0], 'coworker', users[1]);
      var coworker2 = naan.curry(db.relate, users[0], 'coworker', users[2]);
      var friends = naan.curry(db.relate, users[1], 'friends', users[0]);
      async.series([ knows, coworker, coworker2, friends ], function() {
        setTimeout(function() { callback(null, users); }, 20);
      });
    };

    async.waterfall([create, link], done);
  }

  it('should retrieve all links for an object', function(done) {
    createObjs(function(err, users) {
      db.relationships(users[0], function(err, links) {
        assert.ok(!err);
        var types = links.map(function(link) { return link.type; });
        assert.ok(types.indexOf('coworker') !== -1);
        assert.ok(types.indexOf('friends') !== -1);
        assert.ok(types.indexOf('knows') !== -1);
        done();
      });
    });
  });

  it('should retreive all incoming links for an object', function(done) {
    createObjs(function(err, users) {
      db.relationships(users[0], 'in', function(err, links) {
        assert.ok(!err);
        var types = links.map(function(link) { return link.type; });
        assert.ok(types.indexOf('coworker') === -1);
        assert.ok(types.indexOf('friends') !== -1);
        assert.ok(types.indexOf('knows') === -1);
        done();
      });
    });
  });

  it('should retrieve all outgoing links for an object', function(done) {
    createObjs(function(err, users) {
      db.relationships(users[0], 'out', function(err, links) {
        assert.ok(!err);
        var types = links.map(function(link) { return link.type; });
        assert.ok(types.indexOf('coworker') !== -1);
        assert.ok(types.indexOf('friends') === -1);
        assert.ok(types.indexOf('knows') !== -1);
        done();
      });
    });
  });
  
  it('should fetch links of a certain type', function(done) {
    createObjs(function(err, users) {
      db.relationships(users[0], 'all', 'coworker', function(err, links) {
        assert.ok(!err);
        assert.equal(links.length, 2);
        assert.equal(links[0].start, users[0].id);
        assert.equal(links[1].start, users[0].id);
        assert.equal(links[0].type, 'coworker');
        assert.equal(links[1].type, 'coworker');
        done();
      });
    });
  });

  it('should fetch properties of links', function(done) {
    createObjs(function(err, users) {
      db.relationships(users[0], 'all', 'knows', function(err, links) {
        assert.ok(!err);
        assert.deepEqual(links[0].properties, { since: 'January' });
        done();
      });
    });
  });

  it('should fetch links for multiple objects', function(done) {
    createObjs(function(err, users) {
      db.relationships(users, 'all', function(err, links) {
        assert.ok(!err);
        assert.equal(links[0].length, 4);
        assert.equal(links[1].length, 3);
        assert.equal(links[2].length, 1);
        done();
      });
    });
  });
})

describe('seraph#query, seraph#queryRaw', function() {
  it('should perform a cypher query', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon', age: 23}, 
               {name: 'Neil', age: 60},
               {name: 'Katie', age: 29}], function(err, users) {
        done(null, users[0], users.slice(1));
      });
    }

    function linkObjs(user1, users, done) {
      db.relate(user1, 'knows', users, function(err, links) {
        done(null, user1);
      });
    }

    function query(user, done) {
      var cypher = "start x = node(" + user.id + ") ";
      cypher    += "match x -[r]-> n ";
      cypher    += "return type(r), n.name?, n.age? ";
      cypher    += "order by n.name";
      db.query(cypher, function(err, result) {
        assert.ok(!err);
        assert.deepEqual([{
          'type(r)': 'knows',
          'n.name?': 'Katie',
          'n.age?': 29
        }, {
          'type(r)': 'knows',
          'n.name?': 'Neil',
          'n.age?': 60
        }], result);
        done();
      });
    }
  
    async.waterfall([createObjs, linkObjs, query], done);
  });
  
  it('should perform a cypher query and return whole objects', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon', age: 23}, 
               {name: 'Neil', age: 60},
               {name: 'Katie', age: 29}], function(err, users) {
        done(null, users[0], users.slice(1));
      });
    }

    function linkObjs(user1, users, done) {
      db.relate(user1, 'knows', users, function(err, links) {
        done(null, user1, users);
      });
    }

    function query(user, users, done) {
      var cypher = "start x = node(" + user.id + ") ";
      cypher    += "match x -[r]-> n ";
      cypher    += "return n ";
      cypher    += "order by n.name";
      db.query(cypher, function(err, result) {
        assert.ok(!err);
        assert.deepEqual([ users[1], users[0] ], result);
        done();
      });
    }
  
    async.waterfall([createObjs, linkObjs, query], done);
  });

  it('should perform a cypher query and return rels', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon', age: 23}, 
               {name: 'Neil', age: 60},
               {name: 'Katie', age: 29}], function(err, users) {
        done(null, users[0], users.slice(1));
      });
    }

    function linkObjs(user1, users, done) {
      db.relate(user1, 'knows', users, function(err, links) {
        done(null, user1, users, links);
      });
    }

    function query(user, users, links, done) {
      var cypher = "start x = node(" + user.id + ") ";
      cypher    += "match x -[r]-> n ";
      cypher    += "return r ";
      cypher    += "order by n.name";
      db.query(cypher, function(err, result) {
        assert.ok(!err);
        assert.deepEqual([
          { start: user.id, 
            end: users[1].id, 
            type: 'knows', 
            properties: {},
            id: links[1].id },
          { start: user.id, 
            end: users[0].id, 
            type: 'knows', 
            properties: {},
            id: links[0].id }
        ], result);
        done();
      });
    }
  
    async.waterfall([createObjs, linkObjs, query], done);
  });

  it('should perform a cypher query w/o parsing the result', function(done) {
    function createObjs(done) {
      db.save([{name: 'Jon', age: 23}, 
               {name: 'Neil', age: 60},
               {name: 'Katie', age: 29}], function(err, users) {
        done(null, users[0], users.slice(1));
      });
    }

    function linkObjs(user1, users, done) {
      db.relate(user1, 'knows', users, function(err, links) {
        done(null, user1);
      });
    }

    function queryRaw(user, done) {
      var cypher = "start x = node(" + user.id + ") ";
      cypher    += "match x -[r]-> n ";
      cypher    += "return type(r), n.name?, n.age? ";
      cypher    += "order by n.name";
      db.queryRaw(cypher, function(err, result) {
        assert.ok(!err);
        assert.deepEqual({
          data: [['knows', 'Katie', 29], ['knows', 'Neil', 60]],
          columns: ['type(r)', 'n.name?', 'n.age?']
        }, result);
        done();
      });
    }

    async.waterfall([createObjs, linkObjs, queryRaw], done);
  });
});

describe('seraph#find', function() {
  it('should find some items based on a predicate', function(done) {
    var uniqueKey = 'seraph_find_test' + counter();
    function createObjs(done) {
      var objs = [ {name: 'Jon', age: 23}, 
                   {name: 'Neil', age: 60},
                   {name: 'Katie', age: 29} ];
      for (var index in objs) {
        objs[index][uniqueKey] = true;
      }
      objs[3] = {name: 'Belinda', age: 26};
      objs[3][uniqueKey] = false;

      db.save(objs, function(err, users) {
        done();
      });
    }

    function findObjs(done) {
      var predicate = {};
      predicate[uniqueKey] = true;
      db.find(predicate, function(err, objs) {
        assert.ok(!err);
        assert.equal(objs.length, 3);
        var names = objs.map(function(o) { return o.name });
        assert.ok(names.indexOf('Jon') >= 0);
        assert.ok(names.indexOf('Neil') >= 0);
        assert.ok(names.indexOf('Katie') >= 0);
        assert.ok(names.indexOf('Belinda') === -1);
        done();
      });
    }

    async.series([createObjs, findObjs], done);
  })
});

describe('seraph.index', function() {
  it('should be able to create a standard index', function(done) {
    db.index.create('node', uniqn(), function(err) {
      assert.ok(!err, err);
      done();
    });
  });

  it('should create an index with inferred type', function(done) {
    db.index.create(uniqn(), function(err) {
      assert.ok(!err);
      done();
    });
  });

  it('should create an index with a config', function(done) {
    db.index.create(uniqn(), {
      type: 'fulltext',
      provider: 'lucene'
    }, function(err) {
      assert.ok(!err);
      done();
    });
  });

  it('should create an index for a relationship', function(done) {
    db.index.create('relationship', uniqn(), function(err) {
      assert.ok(!err);
      done();
    });
  });

  it('should create in index with config and inferred type', function(done) {
    db.index.create(uniqn(), {
      type: 'fulltext',
      provider: 'lucene'
    }, function(err) {
      assert.ok(!err);
      done();
    });
  });

  it('should not accept invalid types', function(done) {
    db.index.create('crazyType', uniqn(), function(err) {
      assert.ok(err);
      done();
    });
  });

  it('should accept an array of indexes to create', function(done) {
    db.index.create('relationship', [uniqn(), uniqn(), uniqn()], function(err) {
      assert.ok(!err);
      done();
    });
  });

  it('should be aliased on `seraph.node`', function(done) {
    db.node.index.create(uniqn(), function(err) {
      assert.ok(!err);
      done();
    })
  });

  it('should be aliased on `seraph.rel`', function(done) {
    db.rel.index.create(uniqn(), function(err) {
      assert.ok(!err);
      done();
    })
  });

  it('should add a ndoe to an index', function(done) {
    db.save({name: 'Jon'}, function(err, node) {
      db.node.index.add(uniqn(), node, 'test', 'sannelig', function(err) {
        assert.ok(!err);
        done();
      });
    });
  });
  
  it('should alias seraph.index.add as seraph.node.index', function(done) {
    db.save({name: 'Jon'}, function(err, node) {
      db.node.index(uniqn(), node, 'test', 'sannelig', function(err) {
        assert.ok(!err);
        done();
      });
    });
  });

  it('should read a single object from an index', function(done) {
    var iname = uniqn();

    function createAndIndex(done) {
      db.save({ name: 'Helge' }, function(err, node) {
        db.node.index(iname, node, 'person', 'true', function(err) {
          done();   
        });
      });
    }

    function readIndex(done) {
      db.index.read(iname, 'person', 'true', function(err, node) {
        assert.ok(!err);
        assert.equal(node.name, 'Helge');
        done();
      })
    }

    async.series([createAndIndex, readIndex], done);
  });

  it('should read a single object from an index with a space', function(done) {
    var iname = uniqn();

    function createAndIndex(done) {
      db.save({ name: 'Helge' }, function(err, node) {
        db.node.index(iname, node, 'person', 'has a space', function(err) {
          done();   
        });
      });
    }

    function readIndex(done) {
      db.index.read(iname, 'person', 'has a space', function(err, node) {
        assert.ok(!err);
        assert.equal(node.name, 'Helge');
        done();
      })
    }

    async.series([createAndIndex, readIndex], done);
  });

  it('should read all values of a kv pair in an index', function(done) {
    var iname = uniqn();

    function createAndIndex(done) {
      db.save([{ name: 'Helge' }, { name: 'Erlend' }], function(err, nodes) {
        db.node.index(iname, nodes, 'company', 'brik', function(err) {
          done();   
        });
      });
    }

    function readIndex(done) {
      db.index.read(iname, 'company', 'brik', function(err, nodes) {
        assert.ok(!err);
        var names = nodes.map(function(node) { return node.name });
        assert.ok(names.indexOf("Helge") !== -1);
        assert.ok(names.indexOf("Erlend") !== -1);
        done();
      })
    }

    async.series([createAndIndex, readIndex], done);
  });

  it('should read a kv pair as a relationship', function(done) {
    var iname = uniqn();

    function createAndIndex(done) {
      db.save([{ name: 'Helge' }, { name: 'Erlend' }], function(err, nodes) {
        db.relate(nodes[0], 'knows', nodes[1], function(err, rel) {
          db.rel.index(iname, rel, 'company', 'brik', function(err) {
            done(null, nodes);   
          });
        })
      });
    }

    function readIndex(nodes, done) {
      db.rel.index.read(iname, 'company', 'brik', function(err, rel) {
        assert.ok(!err);
        assert.equal(rel.start, nodes[0].id);
        assert.equal(rel.end, nodes[1].id);
        assert.equal(rel.type, 'knows');
        done();
      })
    }

    async.waterfall([createAndIndex, readIndex], done);
  });
});
